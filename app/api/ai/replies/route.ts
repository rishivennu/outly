import { json, route } from "@/lib/http";
import { replySuggestRequestSchema } from "@/lib/validation";
import { suggestReplies } from "@/lib/ai/replies";
import { chargeAi } from "@/lib/ai-quota";
import { realUserId } from "@/lib/auth";

export const POST = route(
  async (req, { user }) => {
    const body = replySuggestRequestSchema.parse(await req.json());
    await chargeAi(realUserId(user));
    return json(await suggestReplies(body));
  },
  { limit: [30, 60_000] },
);
