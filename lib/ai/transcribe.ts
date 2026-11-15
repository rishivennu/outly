import "server-only";
import { env } from "../env";
import { HttpError } from "../http";
import { normalizeCues, type Cue } from "../captions/cues";
import { cleanWords, cuesFromWords, wordsFromCues, wordsFromFunasr, type SubtitleRules, type Word } from "../captions/subtitle-engine";
import { buildCues, checkChunkWords } from "../captions/timing";
import { languageName, normalizeLang } from "../captions/languages";
import { subtitleRules } from "./engine-store";
import { assertPublicUrl } from "../net/assert-public";
import { db } from "../db";
import { chargeAi } from "../ai-quota";
import { recordCost } from "../subscriptions/costs";
import { CHUNKS_PER_CAPTION_VIDEO } from "../billing/entitlements";

// gemini-flash-latest stopped answering (30 s+ timeouts, 10-30 benchmark), so it no longer goes first.
const MODELS = ["gemini-3.6-flash", "gemini-flash-lite-latest"];
/** Both tries together must fit the route's 60 s maxDuration. */
const BUDGET_MS = 52_000;
const FIRST_TRY_MS = 30_000;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    language: { type: "STRING" },
    words: { type: "ARRAY", items: { type: "OBJECT", properties: { w: { type: "STRING" }, s: { type: "NUMBER" }, e: { type: "NUMBER" } }, required: ["w", "s", "e"] } },
  },
  required: ["language", "words"],
};

export const transcribePrompt = (rules: SubtitleRules, duration: number, lang = "") => `Transcribe the speech in this audio word by word, for on-screen video subtitles.
Return JSON {"language": BCP-47 code of the main spoken language, "words": [{"w": "word", "s": start seconds, "e": end seconds}]}.
Rules: keep the speaker's exact words and language (do not translate); write each language in its own script (Telugu in Telugu script, Tamil in Tamil script, Hindi in Devanagari), and English words the speaker mixes in stay in English; write punctuation as people would read it and attach it to the word before it (so "Hello," and "today."); drop only filler like "um"; one entry per spoken word (for Chinese or Japanese, one per character); nothing for music or silence.
Timing: this audio is ${duration.toFixed(2)} seconds long. s and e are seconds (not milliseconds) from the start of THIS audio, as numbers with two decimals, between 0 and ${duration.toFixed(2)}, in the order spoken. s is when the word starts being heard, e when it stops; leave pauses as gaps between words.${lang ? ` The speaker talks mainly in ${languageName(lang)} (${lang}).` : ""}${rules.hotwords.length ? ` These names may come up, spell them exactly: ${rules.hotwords.join(", ")}.` : ""} If nobody speaks, return {"language":"", "words": []}.`;

/** The line rules the editor needs to rebuild whole-video lines from the stitched words. */
export type LineRules = Pick<SubtitleRules, "maxChars" | "maxWords" | "minCue" | "maxCue" | "pause">;
export type Transcript = { cues: Cue[]; words: Word[]; language: string; engine: "gemini" | "funasr"; lines: LineRules };

const lineRules = (r: SubtitleRules): LineRules => ({ maxChars: r.maxChars, maxWords: r.maxWords, minCue: r.minCue, maxCue: r.maxCue, pause: r.pause });

/** FunClip's own engine: a FunASR worker (Paraformer + VAD + punctuation) behind FUNASR_URL or the admin setting. */
async function viaFunasr(url: string, wav: ArrayBuffer, offset: number, duration: number, rules: SubtitleRules): Promise<Transcript | null> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "audio/wav", ...(env.FUNASR_TOKEN ? { authorization: `Bearer ${env.FUNASR_TOKEN}` } : {}), ...(rules.hotwords.length ? { "x-hotwords": rules.hotwords.join(" ").slice(0, 400) } : {}) },
    body: wav,
    redirect: "error",
    signal: AbortSignal.timeout(50_000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const words = wordsFromFunasr(j, offset, offset + duration);
  return { words, cues: cuesFromWords(words, rules), language: normalizeLang(j?.language ?? j?.[0]?.language ?? ""), engine: "funasr", lines: lineRules(rules) };
}

/** One model answer -> words on the video timeline, or the reason its times can't be trusted. */
export function readGeminiAnswer(parsed: unknown, offset: number, duration: number): { ok: true; words: Word[]; language: string } | { ok: false; reason: string } {
  const p = (parsed ?? {}) as Record<string, unknown>;
  const language = normalizeLang(p.language);
  if (Array.isArray(p.words)) {
    const t = checkChunkWords(p.words, duration, offset);
    if (!t.ok) return t;
    return { ok: true, words: cleanWords(t.words, offset, offset + duration), language };
  }
  // Older answers in cue form still work.
  if (Array.isArray(parsed) || Array.isArray(p.cues)) {
    const cues = normalizeCues((Array.isArray(parsed) ? parsed : p.cues) as { start: unknown; end: unknown; text: unknown }[], offset + duration, offset);
    return { ok: true, words: wordsFromCues(cues), language };
  }
  return { ok: false, reason: "no words in the answer" };
}

async function viaGemini(wav: ArrayBuffer, offset: number, duration: number, rules: SubtitleRules, lang: string, signal?: AbortSignal): Promise<Transcript> {
  if (!env.GEMINI_API_KEY) throw new HttpError(503, "AI transcription needs a Gemini API key on the server. You can still type or paste your captions.", "NO_AI");
  const data = Buffer.from(wav).toString("base64");
  const stopAt = Date.now() + BUDGET_MS;
  let lastErr = "";
  let badTiming = false;
  // Two tries at most: the second goes to the other model when the first fails or its times are garbage.
  for (let i = 0; i < MODELS.length; i++) {
    const left = stopAt - Date.now();
    if (left < 8_000 || signal?.aborted) break;
    const model = MODELS[i];
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inline_data: { mime_type: "audio/wav", data } }, { text: transcribePrompt(rules, duration, lang) }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0.1 },
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(i === 0 ? Math.min(FIRST_TRY_MS, left) : left)]) : AbortSignal.timeout(i === 0 ? Math.min(FIRST_TRY_MS, left) : left),
      });
      if (!r.ok) {
        lastErr = `${model} ${r.status}`;
        continue;
      }
      const j = await r.json();
      const txt: string | undefined = j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
      if (!txt) {
        lastErr = `${model} empty`;
        continue;
      }
      const got = readGeminiAnswer(JSON.parse(txt.replace(/^```(?:json)?|```$/g, "").trim()), offset, duration);
      if (!got.ok) {
        badTiming = true;
        lastErr = got.reason;
        console.warn(`[transcribe] ${model} at ${offset}s: ${got.reason}`);
        continue;
      }
      const language = got.language || lang;
      return { words: got.words, cues: buildCues(got.words, rules, offset + duration), language, engine: "gemini", lines: lineRules(rules) };
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  if (badTiming) throw new HttpError(502, "The timings for this part didn't line up, so we left it out rather than guess. Try this part again.", "BAD_TIMING");
  throw new HttpError(502, `Transcription didn't come back (${lastErr || "no answer"}). Try again, or type your captions.`, "AI_FAILED");
}

/** One chunk of 16 kHz mono WAV -> word timings and subtitle lines, offset to where the chunk sits in the video.
 * The FunASR worker is used when it is switched on (off by default); if it is down, Gemini answers instead.
 * `lang` is the creator's pick for the spoken language, sent to Gemini as a hint; empty = detect it. */
export async function transcribeWav(wav: ArrayBuffer, offset: number, duration: number, opts: { lang?: string; signal?: AbortSignal } = {}): Promise<Transcript> {
  const rules = await subtitleRules();
  const url = rules.workerUrl || env.FUNASR_URL;
  if (rules.provider === "funasr" && url) {
    try {
      // FUNASR_URL is the operator's own (may be private); an admin-typed URL is re-checked before every call.
      if (rules.workerUrl && process.env.NODE_ENV === "production") await assertPublicUrl(rules.workerUrl);
      const t = await viaFunasr(url, wav, offset, duration, rules);
      if (t && (t.words.length || !env.GEMINI_API_KEY)) return t;
    } catch (e) {
      console.warn("[transcribe] FunASR worker failed, using Gemini:", (e as Error).message);
    }
  }
  return viaGemini(wav, offset, duration, rules, normalizeLang(opts.lang), opts.signal);
}

/** A transcription run: one per "Transcribe" press, shared by its chunks and its retries for half an hour. */
export const RUN_FEATURE = "caption-run";
/** One row per distinct audio chunk (by content hash) a run has sent, so a run can't reuse its one charge forever. */
export const RUN_CHUNK_FEATURE = "caption-run-chunk";
export const RUN_TTL_MS = 30 * 60_000;
const RUN_RE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Counts one AI request per run, not per chunk. The first chunk to arrive claims the run row and is charged;
 * later chunks and retries of the same video ref + run only add their real transcription minutes to the cost
 * meter. The claim lives in the database, so it holds across instances. A request without a run id (an older
 * client) is charged per chunk, as before. The per-chunk caption budget in assertCaptionVideo still meters audio.
 * `chunk` is the server's hash of this chunk's audio: a byte-identical resend is free, but every
 * CHUNKS_PER_CAPTION_VIDEO distinct chunks in one run cost one more request, so new audio is always metered.
 */
export async function chargeRun(userId: string, ref: string, run: string, duration: number, now = new Date(), chunk = "") {
  const meter = { category: "transcription" as const, units: duration / 60 };
  if (!RUN_RE.test(run)) return void (await chargeAi(userId, "ai", now, meter, "transcription"));
  const key = `${ref.slice(0, 80)}#${run}`;
  const charged = await claimRun(userId, key, meter, now);
  if (!chunk) {
    if (!charged) await recordCost({ userId, ...meter, now });
    return;
  }
  let row: string;
  try {
    row = (await db.featureUse.create({ data: { userId, feature: RUN_CHUNK_FEATURE, period: "run", ref: `${key}:${chunk}` }, select: { id: true } })).id;
  } catch (err) {
    // The same audio again (a lost answer, a retry): already counted. Anything else must not pass silently.
    if ((err as { code?: string } | null)?.code !== "P2002") throw err;
    if (!charged) await recordCost({ userId, ...meter, now });
    return;
  }
  if (charged) return;
  const distinct = await db.featureUse.count({ where: { userId, feature: RUN_CHUNK_FEATURE, period: "run", ref: { startsWith: `${key}:` } } });
  if (distinct <= CHUNKS_PER_CAPTION_VIDEO || (distinct - 1) % CHUNKS_PER_CAPTION_VIDEO !== 0) {
    await recordCost({ userId, ...meter, now });
    return;
  }
  try {
    await chargeAi(userId, "ai", now, meter, "transcription");
  } catch (e) {
    await db.featureUse.deleteMany({ where: { id: row } });
    throw e;
  }
}

/** Claims the run for this request and charges it; false when the run was already charged within RUN_TTL_MS. */
async function claimRun(userId: string, key: string, meter: { category: "transcription"; units: number }, now: Date) {
  const seen = await db.featureUse.findFirst({ where: { userId, feature: RUN_FEATURE, period: "run", ref: key }, select: { id: true, createdAt: true } });
  if (seen && now.getTime() - seen.createdAt.getTime() < RUN_TTL_MS) return false;
  let claimed: string | null = null;
  if (seen) await db.featureUse.update({ where: { id: seen.id }, data: { createdAt: now } });
  else {
    try {
      claimed = (await db.featureUse.create({ data: { userId, feature: RUN_FEATURE, period: "run", ref: key }, select: { id: true } })).id;
    } catch {
      // Another chunk of this run claimed it a moment ago.
      return false;
    }
  }
  try {
    await chargeAi(userId, "ai", now, meter, "transcription");
  } catch (e) {
    // Refused (limit, budget): the run was not charged, so the next try must be.
    if (claimed) await db.featureUse.deleteMany({ where: { id: claimed } });
    else if (seen) await db.featureUse.update({ where: { id: seen.id }, data: { createdAt: seen.createdAt } }).catch(() => {});
    throw e;
  }
  return true;
}
