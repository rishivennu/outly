import { json, route } from "@/lib/http";
import { replySuggestRequestSchema } from "@/lib/validation";
import { suggestReplies } from "@/lib/ai/replies";

export const POST = route(
  async (req) => {
    const body = replySuggestRequestSchema.parse(await req.json());
    return json(await suggestReplies(body));
  },
  { limit: [30, 60_000] },
);
