import { randomUUID } from "node:crypto";
import { z } from "zod";
import { json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { replyToComment } from "@/lib/inbox";
import { replyToThread, sendOnce } from "@/lib/messages/service";
import { reserveReply } from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";

/**
 * 1136: a reply typed straight into a device notification (public/sw.js posts here).
 *
 * The push payload carries only the ids of the conversation it is about; who may answer is decided here,
 * from the session, exactly as the Inbox reply routes do: the thread or post destination must belong to
 * this workspace and be inside the member's account scope, the account must still be connected, and the
 * platform's own reply window still applies. A reply never counts as sent until the platform confirmed it:
 * the answer this route returns is the platform's, and the worker only says "Sent" when it sees `sent: true`.
 *
 * Idempotent: the same text to the same place inside ten minutes gets the first attempt's answer back
 * (`sendOnce`), so a notification tapped twice, or a worker retried by the browser, never doubles a reply.
 */
const Body = z.union([
  z.object({ k: z.literal("dm"), t: z.string().min(1).max(200), text: z.string().trim().min(1).max(1000) }),
  z.object({ k: z.literal("cm"), t: z.string().min(1).max(200), c: z.string().min(1).max(200), text: z.string().trim().min(1).max(1000) }),
]);

export const POST = route(
  async (req, { user }) => {
    const b = Body.parse(await req.json());
    // Same text, same place: one send. The hash keeps the message itself out of the dedupe key.
    const key = `push:${user.id}:${b.k}:${b.t}:${b.k === "cm" ? b.c : ""}:${sha256(b.text).slice(0, 24)}`;
    const run = async () => {
      const slot = await reserveReply(user.id, `${b.k === "cm" ? b.c : b.t}:${randomUUID()}`);
      try {
        if (b.k === "dm") {
          const sent = await replyToThread(user.id, realUserId(user), b.t, b.text, user.scope);
          if (sent.practice) await slot.release();
          return { sent: true, practice: sent.practice, href: `/inbox?tab=messages&thread=${encodeURIComponent(b.t)}` };
        }
        const reply = await replyToComment(user.id, b.t, b.c, b.text, user.scope);
        if (reply.practice) await slot.release();
        return { sent: true, practice: !!reply.practice, href: `/inbox?comment=${encodeURIComponent(b.c)}&target=${encodeURIComponent(b.t)}` };
      } catch (err) {
        await slot.release();
        throw err;
      }
    };
    const { p, duplicate } = sendOnce(key, run);
    return json({ ...(await p), duplicate }, { status: duplicate ? 200 : 201 });
  },
  { limit: [30, 60_000] },
);
