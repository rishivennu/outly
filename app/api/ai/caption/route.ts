import { json, route, HttpError } from "@/lib/http";
import { captionAskRequestSchema } from "@/lib/validation";
import { askSourceCaption } from "@/lib/ai/adapt";
import { chargeAi, refundAi } from "@/lib/ai-quota";
import { realUserId } from "@/lib/auth";
import { voiceFor } from "@/lib/ai/voice";

/**
 * R1206: one of Pip's asks on the creator's own caption, on Your Story. One suggestion comes back for the one
 * editor and goes in only when the creator applies it. No template fallback: when no model answered, nothing
 * is counted and the page says the caption is unchanged.
 */
export const POST = route(
  async (req, { user }) => {
    const { text, ask } = captionAskRequestSchema.parse(await req.json());
    const uid = realUserId(user);
    const now = new Date();
    const charged = await chargeAi(uid, "ai", now, undefined, "rewrite");
    const out = await askSourceCaption(text, ask, { cacheKey: uid, signal: req.signal, voice: await voiceFor(uid) });
    if (!out) {
      await refundAi(uid, charged, "ai", now);
      throw new HttpError(503, "Pip couldn't do that just now. Your caption is unchanged, so try again in a moment.", "ai_busy");
    }
    // Nothing new came back: the page says the caption is unchanged, so it is not counted either.
    if (out.text.trim() === text.trim()) await refundAi(uid, charged, "ai", now);
    return json(out);
  },
  { limit: [30, 60_000] },
);
