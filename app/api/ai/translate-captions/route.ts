import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { chargeAi, refundAi } from "@/lib/ai-quota";
import { translateCues, translationReady } from "@/lib/ai/translate";
import { LANG_RE } from "@/lib/captions/languages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lines per request. A longer video is sent by the browser in windows of TRANSLATE_WINDOW lines (lib/client/captions.ts). */
const MAX_LINES = 600;

const cue = z.object({
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  text: z.string().max(400),
});

const schema = z
  .object({
    cues: z.array(cue).min(1, "Add a caption line first.").max(MAX_LINES, `Translate up to ${MAX_LINES} lines at a time.`),
    from: z.union([z.literal("auto"), z.string().regex(LANG_RE, "Pick the spoken language from the list.")]).default("auto"),
    to: z.literal("en"),
    only: z.array(z.number().int().min(0).max(MAX_LINES - 1)).max(MAX_LINES).optional(),
  })
  .refine((b) => b.cues.every((c) => c.end > c.start), { message: "Every line needs an end after its start.", path: ["cues"] })
  .refine((b) => b.cues.some((c) => c.text.trim()), { message: "The lines have no words to translate.", path: ["cues"] });

/**
 * POST {cues:[{start,end,text}], from, to:"en", only?} -> the same number of lines with the same times, in
 * English. Lines the model left out come back in `untranslated` with their source text, never made up.
 */
export const POST = route(
  async (req, { user }) => {
    const body = schema.parse(await req.json());
    if (!translationReady()) throw new HttpError(503, "Translation is not set up on this workspace. You can still edit the lines yourself.", "NO_AI");
    // One charge per request, before the model, like every other AI call; given back if nothing comes back.
    const uid = realUserId(user);
    const now = new Date();
    const charged = await chargeAi(uid, "ai", now, { category: "ai", units: 1 }, "translation");
    const out = await translateCues(body.cues, body.from, { only: body.only, signal: req.signal }).catch(async (e) => {
      await refundAi(uid, charged, "ai", now);
      throw e;
    });
    const asked = body.only?.length ? new Set(body.only.filter((i) => i < body.cues.length)).size : body.cues.length;
    if (out.untranslated.length >= asked) {
      await refundAi(uid, charged, "ai", now);
      throw new HttpError(502, "The translation didn't come back. Try again in a moment.", "AI_FAILED");
    }
    return json({ cues: out.cues, untranslated: out.untranslated, from: body.from, to: body.to, engine: out.engine });
  },
  { limit: [10, 60_000] },
);
