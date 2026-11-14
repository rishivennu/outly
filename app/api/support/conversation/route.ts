import { z } from "zod";
import { json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { getConversation, listConversations, reopen, resolveAndSend, transcriptAvailable } from "@/lib/support/conversations";

export const dynamic = "force-dynamic";

/**
 * 1151: GET lists this person's saved Pip chats (newest first) and whether a transcript can be emailed right
 * now, so the widget only offers "Resolve & Send Transcript" when it would work. GET ?id= returns one chat
 * with its messages, to reopen it in the widget. Always the person really signed in, never the owner's.
 */
export const GET = route(async (req, { user }) => {
  const who = realUserId(user);
  const id = req.nextUrl.searchParams.get("id");
  const headers = { "cache-control": "private, no-store" };
  if (id) return json(await getConversation(who, id.slice(0, 40)), { headers });
  const [items, transcript] = await Promise.all([listConversations(who), transcriptAvailable(who)]);
  return json({ items, transcript }, { headers });
}, { limit: [60, 60_000] });

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
