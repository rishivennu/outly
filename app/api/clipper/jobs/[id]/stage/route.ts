import { z } from "zod";
import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { failJob, heartbeat, moveJob, saveTranscript, TRANSCRIPT_MAX } from "@/lib/clipper/jobs";
import { EXECUTORS } from "@/lib/clipper/settings-core";

export const dynamic = "force-dynamic";

/** A word as the browser engine emits it ({ w, s, e }) or as other engines do ({ text, start, end }); cleanWords reads both. */
const word = z.object({ w: z.string().max(200).optional(), text: z.string().max(200).optional(), s: z.number().optional(), start: z.number().optional(), e: z.number().optional(), end: z.number().optional() }).passthrough();
const cue = z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().max(400) }).passthrough();

const body = z.discriminatedUnion("event", [
  z.object({ event: z.literal("start"), executor: z.enum(EXECUTORS).optional() }),
  z.object({ event: z.literal("heartbeat"), progress: z.number().min(0).max(100), executor: z.enum(EXECUTORS).optional() }),
  z.object({
    event: z.literal("transcribed"),
    words: z.array(word).max(TRANSCRIPT_MAX.words),
    cues: z.array(cue).max(TRANSCRIPT_MAX.cues).optional(),
    language: z.string().max(16).optional(),
    engine: z.string().max(40).optional(),
    durationSec: z.number().positive().max(24 * 3600).nullable().optional(),
  }),
  z.object({ event: z.literal("fail"), error: z.string().max(500) }),
  z.object({ event: z.literal("retry") }),
  z.object({ event: z.literal("reviewed") }),
]);

/**
 * R1321: the executor (the creator's browser in v1, a worker later) reports where a job is. Transitions follow
 * the state machine in settings-core; an out-of-order report is a 409, never a silent overwrite.
 */
export const POST = route(
  async (req, { user, params }) => {
    const b = body.parse(await req.json());
    const actor = { id: realUserId(user), role: user.role };
    switch (b.event) {
      case "start":
        return json({ job: await moveJob(user.id, params.id, "start", actor, b.executor ? { executor: b.executor } : {}) });
      case "heartbeat":
        return json({ job: await heartbeat(user.id, params.id, b.progress, b.executor) });
      case "transcribed":
        return json(await saveTranscript(user.id, params.id, { words: b.words, cues: b.cues, language: b.language, engine: b.engine, durationSec: b.durationSec }, actor));
      case "fail":
        return json({ job: await failJob(user.id, params.id, b.error, actor) });
      case "retry":
        return json({ job: await moveJob(user.id, params.id, "retry", actor) });
      case "reviewed":
        return json({ job: await moveJob(user.id, params.id, "reviewed", actor) });
    }
  },
  { limit: [240, 60_000] },
);
