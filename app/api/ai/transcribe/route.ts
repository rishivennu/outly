import { json, route, HttpError } from "@/lib/http";
import { transcribeWav } from "@/lib/ai/transcribe";
import { assertCaptionVideo } from "@/lib/billing/entitlements";
import { chargeAi } from "@/lib/ai-quota";
import { realUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX = 4 * 1024 * 1024; // one ~60 s chunk of 16 kHz mono WAV is ~1.9 MB; stays under serverless body limits

/** POST raw audio/wav (one chunk). ?offset=seconds into the video, &duration=chunk length. */
export const POST = route(
  async (req, { user }) => {
    const type = req.headers.get("content-type") ?? "";
    if (!type.startsWith("audio/wav")) throw new HttpError(415, "Send the audio as WAV.", "BAD_TYPE");
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX) throw new HttpError(413, "That audio chunk is too big. Send 60 seconds at a time.", "TOO_LARGE");
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX) throw new HttpError(413, "That audio chunk is too big. Send 60 seconds at a time.", "TOO_LARGE");
    if (buf.byteLength < 44) throw new HttpError(400, "That audio is empty.", "EMPTY");
    // Metering comes last, just before the model call, so a rejected request never uses the allowance.
    // Counts per video (ref), not per chunk: a 3-minute clip sent in 60 s chunks uses one allowance.
    await assertCaptionVideo(user.id, req.nextUrl.searchParams.get("ref") ?? "");
    await chargeAi(realUserId(user));
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset")) || 0);
    const duration = Math.max(0.1, Math.min(120, Number(req.nextUrl.searchParams.get("duration")) || 60));
    return json(await transcribeWav(buf, offset, duration));
  },
  { limit: [20, 60_000] },
);
