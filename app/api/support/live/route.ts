import { z } from "zod";
import { json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { agentsOnline, cancelRequest, customerPoll, customerSend, customerTyping, leaveMessage, rate, requestHuman } from "@/lib/support/live";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };
const num = (v: string | null) => (v == null || v === "" ? null : Number(v));

/**
 * R1184 Live Assist, customer side. GET ?conversationId=&after=&read= is the widget's check-in: the state from
 * real rows, messages after its cursor, typing and receipts. Without a conversation it only says whether anyone
 * from the support team is around (a yes or no, never how many). Always the person really signed in.
 */
export const GET = route(async (req, { user }) => {
  const p = req.nextUrl.searchParams;
  const id = p.get("conversationId");
  if (!id) return json({ online: (await agentsOnline()) > 0 }, { headers: NO_STORE });
  const snap = await customerPoll(realUserId(user), { conversationId: id.slice(0, 40), after: num(p.get("after")), read: num(p.get("read")) });
  return json(snap, { headers: NO_STORE });
}, { limit: [150, 60_000] });

const Id = z.string().min(1).max(40);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), conversationId: Id.nullish(), message: z.string().max(4000).optional(), cid: z.string().max(40).optional() }),
  z.object({ action: z.literal("send"), conversationId: Id, text: z.string().max(4000), cid: z.string().max(40).optional() }),
  z.object({ action: z.literal("typing"), conversationId: Id }),
  z.object({ action: z.literal("read"), conversationId: Id, read: z.number().int().min(0).max(1e9) }),
  z.object({ action: z.literal("cancel"), conversationId: Id }),
  z.object({ action: z.literal("leave"), conversationId: Id, text: z.string().max(4000).optional() }),
  z.object({ action: z.literal("csat"), conversationId: Id, helpful: z.boolean() }),
]);

/** Connect, write, typing, seen, cancel or end, leave a message, and rate a finished chat. */
export const POST = route(async (req, { user }) => {
  const b = Body.parse(await req.json());
  const who = realUserId(user);
  const h = { headers: NO_STORE };
  switch (b.action) {
    case "request":
      return json(await requestHuman(who, { conversationId: b.conversationId, message: b.message, cid: b.cid }), h);
    case "send":
      return json(await customerSend(who, { conversationId: b.conversationId, text: b.text, cid: b.cid }), h);
    case "typing":
      return json(await customerTyping(who, b.conversationId), h);
    case "read":
      return json(await customerPoll(who, { conversationId: b.conversationId, read: b.read, after: Number.MAX_SAFE_INTEGER }), h);
    case "cancel":
      return json(await cancelRequest(who, b.conversationId), h);
    case "leave":
      return json(await leaveMessage(who, { conversationId: b.conversationId, text: b.text }), h);
    case "csat":
      return json(await rate(who, { conversationId: b.conversationId, helpful: b.helpful }), h);
  }
}, { limit: [120, 60_000] });
