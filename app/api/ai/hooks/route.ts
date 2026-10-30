import { json, ndjson, route, wantsStream } from "@/lib/http";
import { hookRequestSchema } from "@/lib/validation";
import { generateHooks } from "@/lib/ai/creative";
import { chargeAi } from "@/lib/ai-quota";
import { realUserId } from "@/lib/auth";

// Streams when asked (Accept: application/x-ndjson): the first hook shows in about a second instead of
// after the whole answer. Plain JSON for everyone else (older app builds, scripts).
export const POST = route(
  async (req, { user }) => {
    const { story, tone, exclude } = hookRequestSchema.parse(await req.json());
    const uid = realUserId(user);
    await chargeAi(uid);
    const opts = { cacheKey: uid, signal: req.signal };
    if (!wantsStream(req)) return json(await generateHooks(story, tone, exclude, opts));
    return ndjson((send) => generateHooks(story, tone, exclude, { ...opts, onPart: (p) => send(p) }));
  },
  { limit: [30, 60_000] },
);
