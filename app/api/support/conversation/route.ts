import { z } from "zod";
import { json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { reopen, resolveAndSend } from "@/lib/support/conversations";

const Body = z.object({
  action: z.enum(["resolve", "reopen"]),
  conversationId: z.string().min(1).max(40),
});

/**
 * 1126: close a Pip conversation and email its transcript, or reopen it. Signed in only; the conversation must
 * belong to the person really signed in (a teammate acting in a workspace resolves their own chat, never the
 * owner's). The address is always the account's own verified email, never one sent by the browser.
 */
export const POST = route(async (req, { user }) => {
  const b = Body.parse(await req.json());
  const who = realUserId(user);
  if (b.action === "reopen") return json({ ok: true, ...(await reopen(who, b.conversationId)) });
  return json(await resolveAndSend(who, b.conversationId));
}, { limit: [20, 60_000] });
