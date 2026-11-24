import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { HttpError } from "../http";
import { firstName } from "./live-core";

/**
 * Pip conversations (1126). A signed-in person's chat is written down as it happens, so what is saved is what was
 * really on screen, not whatever a browser sends. R1311: the transcript email is retired; Resolve/End chat only
 * close the conversation. Rules:
 * - Every read and write is keyed by id AND userId: someone else's conversation id is simply "not found".
 * - Only the visible words are stored. Records cards (posts, invoices), tool output and the model's
 *   instructions never are, so they never reach the saved history.
 * - Kept PIP_CHAT_KEEP_DAYS after the last message (lib/retention/prune.ts), deleted with the account.
 *   R1184: a chat that ever reached the support team (a SupportSession) is kept, so resolved chats stay on record.
 * - R1184: roles are user | pip | agent (a support specialist) | system (a status code, lib/support/live-core.ts SYS).
 *   Every message gets the next number (seq) inside a transaction, so both sides read one order.
 */

export const PIP_CHAT_KEEP_DAYS = 90;
/** 1151 convStatus: a send claim (sendingAt) older than this is stale. R1311: nothing claims any more; kept for old rows. */
const SEND_LOCK_MS = 60_000;
const MAX_TEXT = 4000;

const ALPH = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const newRef = () => "C-" + [...randomBytes(6)].map((b) => ALPH[b % ALPH.length]).join("");
const subjectOf = (q: string) => {
  const s = q.replace(/\s+/g, " ").trim();
  return s.length > 90 ? s.slice(0, 87) + "..." : s || "Support conversation";
};

export type ConvState = { id: string; status: "open" | "resolved" };
/** 1151: what a person sees. pending = a transcript email is on its way right now (the send claim is held). */
export type ConvStatus = "open" | "pending" | "resolved";
export function convStatus(c: { status: string; sendingAt: Date | null }, now = new Date()): ConvStatus {
  if (c.status === "resolved") return "resolved";
  return c.sendingAt && now.getTime() - c.sendingAt.getTime() < SEND_LOCK_MS ? "pending" : "open";
}

/** Where past chats really live in the studio (1151). Pip says exactly this, never a section that doesn't exist. */
export const PAST_CHATS_PATH = "/support#pip-conversations";
export const PAST_CHATS_TEXT =
  "Your chats with Pip are saved for 90 days. Open **Help centre** in the sidebar, then scroll to **Your Pip conversations** ([open it](/support#pip-conversations)). Press **Continue in Pip** on any of them to pick it up again here.";
export const PAST_CHATS_VISITOR = "Chats are only saved when you're signed in. Sign in, then open **Help centre** in the sidebar and scroll to **Your Pip conversations**.";

export type ConvListItem = { id: string; ref: string; subject: string; status: ConvStatus; updatedAt: string; messages: number; sentTo: string | null };
/** 1151: this person's own saved chats, newest first. Only theirs: keyed by the real signed-in id. */
export async function listConversations(userId: string, take = 20): Promise<ConvListItem[]> {
  const now = new Date();
  const rows = await db.pipConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(take, 1), 50),
    select: { id: true, ref: true, subject: true, status: true, sendingAt: true, sentTo: true, updatedAt: true, _count: { select: { messages: true } } },
  });
  return rows.map((c) => ({ id: c.id, ref: c.ref, subject: c.subject, status: convStatus(c, now), updatedAt: c.updatedAt.toISOString(), messages: c._count.messages, sentTo: c.status === "resolved" ? c.sentTo : null }));
}

/** 1151: one saved chat with its messages, to reopen it in the widget. Someone else's id is simply "not found". */
export type ConvRole = "user" | "bot" | "agent" | "system";
/** R1184: Pip's rows are "bot" on the wire (as before); a specialist shows by first name only; system rows stay codes. */
export const wireRole = (role: string): ConvRole => (role === "user" ? "user" : role === "agent" ? "agent" : role === "system" ? "system" : "bot");
export async function getConversation(userId: string, id: string) {
  const c = await db.pipConversation.findFirst({ where: { id, userId }, select: { id: true, ref: true, subject: true, status: true, sendingAt: true, sentTo: true, mode: true, liveId: true, seq: true } });
  if (!c) throw new HttpError(404, "We couldn't find that conversation.", "NOT_FOUND");
  const rows = await db.pipMessage.findMany({ where: { conversationId: c.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 80, select: { id: true, role: true, text: true, seq: true, authorName: true } });
  rows.reverse();
  return {
    id: c.id,
    ref: c.ref,
    subject: c.subject,
    status: convStatus(c),
    sentTo: c.status === "resolved" ? (c.sentTo ?? "") : null,
    mode: c.mode,
    live: !!c.liveId,
    seq: c.seq,
    messages: rows.map((m) => ({ id: m.id, seq: m.seq, role: wireRole(m.role), text: m.text, author: m.role === "agent" ? firstName(m.authorName) : null })),
  };
}

/** R1184: hands out the next n message numbers. Inside a transaction the row stays locked until commit, so numbers commit in order. */
export async function nextSeqs(tx: Pick<typeof db, "pipConversation">, conversationId: string, n = 1, data: Record<string, unknown> = {}) {
  const c = await tx.pipConversation.update({ where: { id: conversationId }, data: { ...data, seq: { increment: n } }, select: { seq: true } });
  return Array.from({ length: n }, (_, i) => c.seq - n + 1 + i);
}

/** R1184: a conversation to hang a request for a person on, when Pip hasn't written one down yet. */
export async function startConversation(userId: string, subject: string) {
  for (let i = 0; i < 5; i++) {
    try {
      return await db.pipConversation.create({ data: { ref: newRef(), userId, subject: subjectOf(subject) }, select: { id: true } });
    } catch (e: any) {
      if (e?.code !== "P2002") throw e;
    }
  }
  throw new Error("Could not start a conversation");
}

/**
 * The open conversation a new message belongs to. An id that isn't this person's (or no longer exists)
 * starts a new one instead of failing, so nothing about other people's chats leaks. A resolved one refuses
 * new messages until it is reopened: the lock holds on the server, not just in the browser.
 */
export async function openConversation(userId: string, id?: string | null): Promise<{ id: string; mode: string } | null> {
  if (!id) return null;
  const c = await db.pipConversation.findFirst({ where: { id, userId }, select: { id: true, status: true, mode: true } });
  if (!c) return null;
  if (c.status === "resolved") throw new HttpError(409, "This conversation is resolved. Reopen it to keep chatting.", "RESOLVED");
  // R1184: waiting or human comes back as is; the chat route then hands the words to the support team, not Pip.
  return { id: c.id, mode: c.mode };
}

/** Writes one question and Pip's answer. Creates the conversation on its first message. */
export async function recordTurn(o: { userId: string; conversation: { id: string } | null; question: string; answer: string; askedAt: Date; answeredAt?: Date }) {
  const at = o.answeredAt ?? new Date();
  // Same instant on both rows would make the order depend on ids: keep the answer at least 1 ms after.
  const answeredAt = at.getTime() > o.askedAt.getTime() ? at : new Date(o.askedAt.getTime() + 1);
  const messages = [
    { role: "user", text: o.question.slice(0, MAX_TEXT), createdAt: o.askedAt, seq: 1 },
    { role: "pip", text: o.answer.slice(0, MAX_TEXT), createdAt: answeredAt, seq: 2 },
  ];
  if (o.conversation) {
    const id = o.conversation.id;
    await db.$transaction(async (tx) => {
      // R1184: the customer asked for a person while Pip was still answering. Keep their words for the team,
      // drop Pip's reply: Pip stays silent once a request is open.
      const now = await tx.pipConversation.findUnique({ where: { id }, select: { mode: true } });
      if (now && (now.mode === "waiting" || now.mode === "human")) {
        const [a] = await nextSeqs(tx, id, 1, { updatedAt: new Date() });
        await tx.pipMessage.create({ data: { ...messages[0], seq: a, conversationId: id } });
        return;
      }
      const [a, b] = await nextSeqs(tx, id, 2, { updatedAt: new Date() });
      await tx.pipMessage.createMany({ data: [{ ...messages[0], seq: a, conversationId: id }, { ...messages[1], seq: b, conversationId: id }] });
    });
    return id;
  }
  for (let i = 0; i < 5; i++) {
    try {
      const c = await db.pipConversation.create({ data: { ref: newRef(), userId: o.userId, subject: subjectOf(o.question), seq: 2, messages: { create: messages } }, select: { id: true } });
      return c.id;
    } catch (e: any) {
      if (e?.code !== "P2002") throw e;
    }
  }
  throw new Error("Could not start a conversation");
}

/** R1311: transcripts are no longer emailed from the widget. Said when someone asks Pip for one. */
export const TRANSCRIPTS_RETIRED_TEXT = "Transcripts aren't emailed from here any more. This conversation stays saved under **Help centre**, **Your Pip conversations**, where you can read it any time.";
/** R1311: shown when Resolve chat or End chat is pressed while a support specialist still has the chat. */
export const LIVE_OPEN_CLOSE_TEXT = "You're chatting with our support team right now. End that chat first, then you can resolve it.";

export type CloseResult = { ok: true; status: "resolved"; already: boolean };

/**
 * R1311 Resolve chat / End chat: mark the conversation resolved on the server without emailing anything. The
 * history stays (nothing is deleted; it is listed under Help centre, Your Pip conversations). Idempotent: a second
 * press, or a second tab, finds it resolved and says so. Refused while a specialist is on the chat (409 LIVE_OPEN):
 * the live session must be ended first, so nobody on the support team is left talking to a closed chat.
 */
export async function closeConversation(userId: string, conversationId: string): Promise<CloseResult> {
  const conv = await db.pipConversation.findFirst({ where: { id: conversationId, userId }, select: { id: true, status: true, mode: true } });
  if (!conv) throw new HttpError(404, "We couldn't find that conversation.", "NOT_FOUND");
  if (conv.status === "resolved") return { ok: true, status: "resolved", already: true };
  if (conv.mode === "waiting" || conv.mode === "human") throw new HttpError(409, LIVE_OPEN_CLOSE_TEXT, "LIVE_OPEN");
  const r = await db.pipConversation.updateMany({ where: { id: conv.id, userId, status: { not: "resolved" }, mode: { notIn: ["waiting", "human"] } }, data: { status: "resolved", resolvedAt: new Date(), sendingAt: null } });
  return { ok: true, status: "resolved", already: r.count === 0 };
}

/** Reopen Conversation: the chat takes messages again. */
export async function reopen(userId: string, conversationId: string): Promise<ConvState> {
  const r = await db.pipConversation.updateMany({ where: { id: conversationId, userId }, data: { status: "open", resolvedAt: null, sendingAt: null } });
  if (!r.count) throw new HttpError(404, "We couldn't find that conversation.", "NOT_FOUND");
  // R1184: a chat the support team resolved goes back to Pip when its owner reopens it (asking for a person again is one tap).
  await db.pipConversation.updateMany({ where: { id: conversationId, userId, mode: "resolved" }, data: { mode: "ai", liveId: null } });
  return { id: conversationId, status: "open" };
}
