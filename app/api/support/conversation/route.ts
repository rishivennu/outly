import { z } from "zod";
import { json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { closeConversation, getConversation, listConversations, reopen } from "@/lib/support/conversations";

export const dynamic = "force-dynamic";

/**
 * 1151: GET lists this person's saved Pip chats (newest first). GET ?id= returns one chat with its messages, to
 * reopen it in the widget. Always the person really signed in, never the owner's. R1311: the transcript
 * availability flag is gone with the transcript email; the widget offers Resolve chat to anyone signed in.
 */
export const GET = route(async (req, { user }) => {
  const who = realUserId(user);
  const id = req.nextUrl.searchParams.get("id");
  const headers = { "cache-control": "private, no-store" };
  if (id) return json(await getConversation(who, id.slice(0, 40)), { headers });
  return json({ items: await listConversations(who) }, { headers });
}, { limit: [60, 60_000] });

const Body = z.object({
  action: z.enum(["resolve", "reopen", "close"]),
  conversationId: z.string().min(1).max(40),
});

/**
 * R1311 "close": Resolve chat / End chat mark the conversation resolved on the server, history kept, nothing
 * emailed. "reopen" takes it back. "resolve" (1126) is kept as a spelling for older app builds and does the same as
 * "close": the transcript email is retired, nothing leaves the server. Signed in only; the conversation must belong to the person really signed in (a
 * teammate acting in a workspace resolves their own chat, never the owner's).
 */
export const POST = route(async (req, { user }) => {
  const b = Body.parse(await req.json());
  const who = realUserId(user);
  if (b.action === "reopen") return json({ ok: true, ...(await reopen(who, b.conversationId)) });
  return json(await closeConversation(who, b.conversationId));
}, { limit: [20, 60_000] });
