import { randomUUID } from "node:crypto";
import { json, route } from "@/lib/http";
import { inboxReplySchema } from "@/lib/validation";
import { replyToComment } from "@/lib/inbox";
import { reserveReply } from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";

export const POST = route(
  async (req, { user }) => {
    const body = inboxReplySchema.parse(await req.json());
    // The slot is held before sending (so two replies at once can't both take the last one) and given back on failure.
    const slot = await reserveReply(user.id, `${body.commentId}:${randomUUID()}`);
    let reply: Awaited<ReturnType<typeof replyToComment>>;
    try {
      reply = await replyToComment(user.id, body.targetId, body.commentId, body.text);
    } catch (err) {
      await slot.release();
      throw err;
    }
    // Practice accounts are for trying things out, so their replies don't use the weekly allowance.
    if (reply.practice) await slot.release();
    const left = slot.replyLimit > 0 ? (reply.practice ? Math.min(slot.replyLimit, slot.left + 1) : slot.left) : null;
    return json({ reply, repliesLeft: left }, { status: 201 });
  },
  { limit: [30, 60_000] },
);
