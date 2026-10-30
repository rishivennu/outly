import { json, ndjson, route, wantsStream } from "@/lib/http";
import { platformCopyRequestSchema } from "@/lib/validation";
import { generatePlatformCopy } from "@/lib/ai/creative";
import { chargeAi } from "@/lib/ai-quota";
import { realUserId } from "@/lib/auth";

// Streams each platform's copy the moment it is written when asked (Accept: application/x-ndjson).
export const POST = route(
  async (req, { user }) => {
    const { story, hook, platforms } = platformCopyRequestSchema.parse(await req.json());
    const uid = realUserId(user);
    await chargeAi(uid);
    const opts = { cacheKey: uid, signal: req.signal };
    if (!wantsStream(req)) return json({ items: await generatePlatformCopy(story, hook, platforms, opts) });
    return ndjson(async (send) => ({ items: await generatePlatformCopy(story, hook, platforms, { ...opts, onItem: (item) => send({ t: "item", item }) }) }));
  },
  { limit: [30, 60_000] },
);
