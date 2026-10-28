import { randomUUID } from "node:crypto";
import { json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { dmReplySchema } from "@/lib/validation";
import { reserveReply } from "@/lib/billing/entitlements";
import { getThread, replyToThread } from "@/lib/messages/service";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** One conversation with its messages. Opening it marks it read. */
export const GET = route<Ctx>(async (_req, { user, params }) => json(await getThread(user.id, params.id, user.scope)), { limit: [120, 60_000] });

/** Reply. Counts against the same weekly reply allowance as comment replies. */
export const POST = route<Ctx>(
  async (req, { user, params }) => {
    const body = dmReplySchema.parse(await req.json());
    const slot = await reserveReply(user.id, `dm:${params.id}:${randomUUID()}`);
    let sent: Awaited<ReturnType<typeof replyToThread>>;
    try {
      sent = await replyToThread(user.id, realUserId(user), params.id, body.text, user.scope);
    } catch (err) {
      await slot.release();
      throw err;
    }
    if (sent.practice) await slot.release();
    const left = slot.replyLimit > 0 ? (sent.practice ? Math.min(slot.replyLimit, slot.left + 1) : slot.left) : null;
    return json({ message: sent.message, practice: sent.practice, repliesLeft: left }, { status: 201 });
  },
  { limit: [30, 60_000] },
);
