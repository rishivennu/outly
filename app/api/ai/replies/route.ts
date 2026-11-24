import { json, route } from "@/lib/http";
import { replySuggestRequestSchema } from "@/lib/validation";
import { suggestReplies } from "@/lib/ai/replies";
import { chargeAi } from "@/lib/ai-quota";
import { realUserId } from "@/lib/auth";
import { assertPerk } from "@/lib/billing/entitlements";
import { track } from "@/lib/analytics/activity";

export const POST = route(
  async (req, { user }) => {
    const body = replySuggestRequestSchema.parse(await req.json());
    await assertPerk(realUserId(user), "ai-replies");
    await chargeAi(realUserId(user), "ai", undefined, undefined, "other");
    track("ai_reply_used", realUserId(user));
    return json(await suggestReplies(body, { feature: "inbox-reply", userId: realUserId(user) }));
  },
  { limit: [30, 60_000] },
);
