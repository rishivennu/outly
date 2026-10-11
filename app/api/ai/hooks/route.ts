import { json, route } from "@/lib/http";
import { hookRequestSchema } from "@/lib/validation";
import { generateHooks } from "@/lib/ai/creative";

export const POST = route(
  async (req) => {
    const { story, tone, exclude } = hookRequestSchema.parse(await req.json());
    return json(await generateHooks(story, tone, exclude));
  },
  { limit: [30, 60_000] },
);
