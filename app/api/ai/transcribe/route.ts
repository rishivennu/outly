import { createHash } from "node:crypto";
import { json, route, HttpError } from "@/lib/http";
import { chargeRun, transcribeWav, type Transcript } from "@/lib/ai/transcribe";
import { assertCaptionVideo } from "@/lib/billing/entitlements";
import { realUserId } from "@/lib/auth";
import { LANG_RE } from "@/lib/captions/languages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX = 4 * 1024 * 1024; // one ~62 s chunk of 16 kHz mono WAV is ~2 MB; stays under serverless body limits

/* The same chunk asked for twice at once (a double click, a retry racing a slow answer) waits for the first.
 * The model call has its own abort, cancelled only once every request waiting on it has gone, so one tab
 * closing never fails another that is still waiting. */
type Job = { work: Promise<Transcript>; waiters: number; ctl: AbortController };
const inflight = new Map<string, Job>();

async function join(job: Job, signal: AbortSignal) {
  job.waiters++;
  let gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    if (--job.waiters <= 0) job.ctl.abort();
  };
  signal.addEventListener("abort", leave, { once: true });
  if (signal.aborted) leave();
  try {
    return await job.work;
  } finally {
    signal.removeEventListener("abort", leave);
    if (!gone) {
      gone = true;
      job.waiters--;
    }
  }
}

/** POST raw audio/wav (one chunk). ?offset=seconds into the video, &duration=chunk length, &ref=video, &run=this run, &chunk=index, &lang=spoken language hint. */
export const POST = route(
  async (req, { user }) => {
    const type = req.headers.get("content-type") ?? "";
    if (!type.startsWith("audio/wav")) throw new HttpError(415, "Send the audio as WAV.", "BAD_TYPE");
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX) throw new HttpError(413, "That audio chunk is too big. Send 60 seconds at a time.", "TOO_LARGE");
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX) throw new HttpError(413, "That audio chunk is too big. Send 60 seconds at a time.", "TOO_LARGE");
    if (buf.byteLength < 44) throw new HttpError(400, "That audio is empty.", "EMPTY");
    const q = req.nextUrl.searchParams;
    const ref = q.get("ref") ?? "";
    const run = q.get("run") ?? "";
    const rawLang = (q.get("lang") ?? "").trim();
    if (rawLang && rawLang !== "auto" && !LANG_RE.test(rawLang)) throw new HttpError(400, "Pick the spoken language from the list.", "BAD_LANG");
    const lang = rawLang === "auto" ? "" : rawLang;
    const offset = Math.max(0, Number(q.get("offset")) || 0);
    const duration = Math.max(0.1, Math.min(120, Number(q.get("duration")) || 60));
    const uid = realUserId(user);
    // The run and chunk ids come from the browser, so dedupe only on audio the server has hashed itself:
    // the same chunk number with different audio is new work and is metered as such.
    const h = createHash("sha256").update(new Uint8Array(buf)).digest("hex").slice(0, 16);
    const key = `${uid}|${ref}|${run}|${q.get("chunk") ?? offset}|${lang}|${h}`;
    const same = inflight.get(key);
    if (same) return json(await join(same, req.signal));

    // Metering comes last, just before the model call, so a rejected request never uses the allowance.
    // Counts per video (ref), not per chunk: a 3-minute clip sent in 60 s chunks uses one allowance.
    const chunkIx = q.get("chunk");
    const slot = await assertCaptionVideo(user.id, ref, new Date(), run && chunkIx ? `${run}:${chunkIx}:${h}` : "");
    const ctl = new AbortController();
    const work = (async () => {
      try {
        // 1147: billed to the monthly cost budget as transcription minutes; Phase 3: one AI request per run,
        // plus one per CHUNKS_PER_CAPTION_VIDEO distinct chunks of audio.
        await chargeRun(uid, ref, run, duration, new Date(), h);
        return await transcribeWav(buf, offset, duration, { lang, signal: ctl.signal });
      } catch (e) {
        // Over the daily AI cap, or the model failed: the creator got no captions, so the slot goes back (1027).
        await slot.release().catch((err) => console.error("[transcribe] release", err));
        throw e;
      }
    })();
    const job: Job = { work, waiters: 0, ctl };
    inflight.set(key, job);
    try {
      return json(await join(job, req.signal));
    } finally {
      if (inflight.get(key) === job) inflight.delete(key);
    }
  },
  { limit: [20, 60_000] },
);
