import { json, ndjson, route, wantsStream, HttpError } from "@/lib/http";
import { platformCopyRequestSchema } from "@/lib/validation";
import { askPlatformCopy, generatePlatformCopy } from "@/lib/ai/creative";
import { chargeAi, refundAi } from "@/lib/ai-quota";
import { realUserId } from "@/lib/auth";
import { voiceFor } from "@/lib/ai/voice";

// Streams each platform's copy the moment it is written when asked (Accept: application/x-ndjson).
export const POST = route(
  async (req, { user }) => {
    const { story, hook, platforms, intent, ask, current } = platformCopyRequestSchema.parse(await req.json());
    const uid = realUserId(user);
    const now = new Date();
    const charged = await chargeAi(uid, "ai", now, undefined, intent === "rewrite" || ask ? "rewrite" : "captions");
    const opts = { cacheKey: uid, signal: req.signal, voice: await voiceFor(uid) };
    // R1198: one of Pip's asks, for one place. No template fallback: a suggestion nobody wrote is not a suggestion.
    if (ask) {
      const item = await askPlatformCopy(story, platforms[0], ask, current ?? { title: "", caption: hook, description: "", hashtags: "" }, opts);
      if (!item) {
        // Nothing came back, so nothing is counted: the creator never pays for "your words are unchanged".
        await refundAi(uid, charged, "ai", now);
        throw new HttpError(503, "Pip couldn't do that just now. Your words are unchanged, so try again in a moment.", "ai_busy");
      }
      return json({ items: [item] });
    }
    if (!wantsStream(req)) return json({ items: await generatePlatformCopy(story, hook, platforms, opts) });
    return ndjson(async (send) => ({ items: await generatePlatformCopy(story, hook, platforms, { ...opts, onItem: (item) => send({ t: "item", item }) }) }));
  },
  { limit: [30, 60_000] },
);
