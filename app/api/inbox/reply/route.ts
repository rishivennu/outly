import { json, route } from "@/lib/http";
import { inboxReplySchema } from "@/lib/validation";
import { replyToComment } from "@/lib/inbox";

export const dynamic = "force-dynamic";

export const POST = route(
  async (req, { user }) => {
    const body = inboxReplySchema.parse(await req.json());
    return json({ reply: await replyToComment(user.id, body.targetId, body.commentId, body.text) }, { status: 201 });
  },
  { limit: [30, 60_000] },
);
