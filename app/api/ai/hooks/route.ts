import { json, route } from "@/lib/http";
import { hookRequestSchema } from "@/lib/validation";
import { generateHooks } from "@/lib/ai/creative";
import { chargeAi } from "@/lib/ai-quota";
import { realUserId } from "@/lib/auth";

export const POST = route(
  async (req, { user }) => {
    const { story, tone, exclude } = hookRequestSchema.parse(await req.json());
    await chargeAi(realUserId(user));
    return json(await generateHooks(story, tone, exclude));
  },
  { limit: [30, 60_000] },
);
