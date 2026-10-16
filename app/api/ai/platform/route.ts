import { json, route } from "@/lib/http";
import { platformCopyRequestSchema } from "@/lib/validation";
import { generatePlatformCopy } from "@/lib/ai/creative";
import { chargeAi } from "@/lib/ai-quota";
import { realUserId } from "@/lib/auth";

export const POST = route(
  async (req, { user }) => {
    const { story, hook, platforms } = platformCopyRequestSchema.parse(await req.json());
    await chargeAi(realUserId(user));
    return json({ items: await generatePlatformCopy(story, hook, platforms) });
  },
  { limit: [30, 60_000] },
);
