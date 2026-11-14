import { json, route } from "@/lib/http";
import { replySuggestRequestSchema } from "@/lib/validation";
import { suggestReplies } from "@/lib/ai/replies";
import { chargeAi } from "@/lib/ai-quota";
import { realUserId } from "@/lib/auth";
import { assertPerk } from "@/lib/billing/entitlements";
import { withAiTurn } from "@/lib/posthog-ai";

export const POST = route(
  async (req, { user }) => {
    const body = replySuggestRequestSchema.parse(await req.json());
    const uid = realUserId(user);
    await assertPerk(uid, "ai-replies");
    await chargeAi(uid);
    return json(await withAiTurn({ distinctId: uid }, () => suggestReplies(body)));
  },
  { limit: [30, 60_000] },
);
