import { z } from "zod";
import { json, route, HttpError } from "@/lib/http";
import { assertAiCaptions } from "@/lib/billing/entitlements";
import { chargeAi } from "@/lib/ai-quota";
import { realUserId } from "@/lib/auth";
import { gemini } from "@/lib/ai/creative";
import { subtitleRules } from "@/lib/ai/engine-store";
import { normalizeCues } from "@/lib/captions/cues";
import { highlightPrompt, parseHighlights } from "@/lib/captions/subtitle-engine";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  duration: z.number().positive().max(4 * 3600),
  cues: z.array(z.object({ start: z.number(), end: z.number(), text: z.string().max(300) })).min(1, "Transcribe the video first.").max(1500),
});

/** FunClip-style AI clipping: Gemini reads the subtitles and picks the moments worth their own clip. */
export const POST = route(
  async (req, { user }) => {
    if (!env.GEMINI_API_KEY) throw new HttpError(503, "Finding highlights needs a Gemini API key on the server. You can still cut by text.", "NO_AI");
    const { cues: raw, duration } = Body.parse(await req.json());
    await assertAiCaptions(user.id);
    await chargeAi(realUserId(user));
    const cues = normalizeCues(raw, duration);
    const rules = await subtitleRules();
    const { system, prompt } = highlightPrompt(cues, rules);
    const out = await gemini<unknown>(system, prompt, { temperature: 0.4, timeoutMs: 40_000, models: ["gemini-flash-latest", "gemini-flash-lite-latest"] });
    if (!out) throw new HttpError(502, "Gemini didn't answer just now. Try again in a minute.", "AI_FAILED");
    return json({ clips: parseHighlights(out, cues, duration, rules) });
  },
  { limit: [10, 60_000] },
);
