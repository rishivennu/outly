import { json, route } from "@/lib/http";
import { platformCopyRequestSchema } from "@/lib/validation";
import { generatePlatformCopy } from "@/lib/ai/creative";

export const POST = route(
  async (req) => {
    const { story, hook, platforms } = platformCopyRequestSchema.parse(await req.json());
    return json({ items: await generatePlatformCopy(story, hook, platforms) });
  },
  { limit: [30, 60_000] },
);
