import { json, ndjson, route, wantsStream } from "@/lib/http";
import { adaptRequestSchema } from "@/lib/validation";
import { adaptCaptions, adaptKey, remember, remembered } from "@/lib/ai/adapt";
import { clarifyFor } from "@/lib/ai/adapt-core";
import { chargeAi } from "@/lib/ai-quota";
import { realUserId } from "@/lib/auth";
import { voiceFor } from "@/lib/ai/voice";

/**
 * 1190 "Write once. Outlly adapts it everywhere." One message in, one caption per place out, streamed card by
 * card (Accept: application/x-ndjson). Too little to go on: Pip asks one question and nothing is charged. The
 * same words again within 30 minutes: the saved answer, also free. Regenerate sends `fresh` to really write again.
 */
export const POST = route(
  async (req, { user }) => {
    const { fresh, noClarify, ...input } = adaptRequestSchema.parse(await req.json());
    const clarify = noClarify ? null : clarifyFor(input.text);
    if (clarify) return json({ clarify });
    const uid = realUserId(user);
    const key = adaptKey(uid, input);
    const hit = fresh ? null : remembered(key);
    if (hit) return json({ ...hit, cached: true });
    await chargeAi(uid, "ai", undefined, undefined, "captions");
    const opts = { cacheKey: uid, signal: req.signal, voice: await voiceFor(uid) };
    if (!wantsStream(req)) {
      const out = await adaptCaptions(input, opts);
      remember(key, out);
      return json(out);
    }
    return ndjson(async (send) => {
      const out = await adaptCaptions(input, { ...opts, onEvent: (e) => send(e) });
      remember(key, out);
      return out;
    });
  },
  { limit: [30, 60_000] },
);
