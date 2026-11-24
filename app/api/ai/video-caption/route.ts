import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { chargeAi } from "@/lib/ai-quota";
import { voiceFor } from "@/lib/ai/voice";
import { generateVideoStory, TRANSCRIPT_MAX } from "@/lib/ai/video-caption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One JPEG frame as plain base64 (no data: prefix). 512px on the long side comes to 30 to 90 KB. */
const frame = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, "Each frame is a base64 JPEG.").min(200).max(600_000);

const schema = z.object({
  frames: z.array(frame).min(1, "Add a video first.").max(6),
  /** The lines already read from the video's sound (the caption editor), when there are any. */
  transcript: z.string().max(TRANSCRIPT_MAX * 2).optional(),
  duration: z.number().positive().max(24 * 3600).optional(),
  /** Asked by the workspace on its own (a video was just added): a plan or quota stop is a quiet skip, not an error. */
  auto: z.boolean().optional(),
});

/** Gemini takes about 20 MB per request and Vercel 4.5 MB per body; frames past this many base64 bytes are left out. */
const BUDGET = 3 * 1024 * 1024;

/**
 * 1160: the Outlly assistant watches the creator's video (frames the browser read from the file, plus the
 * transcript when captions were already read) and writes the story the caption writers start from.
 */
export const POST = route(
  async (req, { user }) => {
    const { frames, transcript, duration, auto } = schema.parse(await req.json());
    const picked: { mime: string; data: string }[] = [];
    let total = 0;
    for (const data of frames) {
      if (total + data.length > BUDGET) break;
      total += data.length;
      picked.push({ mime: "image/jpeg", data });
    }
    if (!picked.length) {
      if (auto) return json({ skipped: "too_big" });
      throw new HttpError(413, "Those frames are too big for the assistant to look at.");
    }

    const uid = realUserId(user);
    try {
      await chargeAi(uid, "ai", undefined, undefined, "captions");
    } catch (e) {
      if (auto && e instanceof HttpError) return json({ skipped: e.code ?? "limit" });
      throw e;
    }
    const heard = transcript?.trim() ? transcript.trim().slice(0, TRANSCRIPT_MAX) : null;
    const out = await generateVideoStory(picked, heard, { signal: req.signal, voice: await voiceFor(uid), cacheKey: uid, duration, meter: { feature: "captions", userId: uid } });
    if (!out) {
      // Each model's refusal is already in the [llm] lines above this one; this says what was asked.
      console.warn(`[video-caption] no model watched the video: ${picked.length} frame(s), ${Math.round(total / 1024)} KB${heard ? ", with transcript" : ""}${auto ? ", auto" : ""}`);
      if (auto) return json({ skipped: "busy" });
      throw new HttpError(503, "The assistant couldn't watch your video just now. Try again in a moment, or tell me about it yourself.", "AI_BUSY");
    }
    return json({ story: out.story, ...(out.seen ? { seen: out.seen } : {}) });
  },
  { limit: [20, 60_000] },
);
