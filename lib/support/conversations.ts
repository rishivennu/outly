import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { sendEmail, templates } from "../email";
import { isProven } from "../founding";
import { limitShared } from "../rate-limit";

/**
 * Pip conversations (1126). A signed-in person's chat is written down as it happens, so "Resolve & Send
 * Transcript" emails what was really on screen, not whatever a browser sends. Rules:
 * - Every read and write is keyed by id AND userId: someone else's conversation id is simply "not found".
 * - Only the visible words are stored. Records cards (posts, invoices), tool output and the model's
 *   instructions never are, so they can't reach a transcript.
 * - The transcript goes only to the account's own email, and only once that address was proven.
 * - One email per resolve: a claim on the row (sendingAt) blocks a second send while the first is on its way,
 *   and a conversation that is already resolved and sent just answers "done" again.
 * - Kept PIP_CHAT_KEEP_DAYS after the last message (lib/retention/prune.ts), deleted with the account.
 */

export const PIP_CHAT_KEEP_DAYS = 90;
export const TRANSCRIPT_SUBJECT = "Your Outlly Support Conversation \u2013 Transcript";
/** A transcript email is long enough already; older messages are counted instead of shown. */
export const TRANSCRIPT_MAX_MESSAGES = 400;
/** Longer than the provider's 12 s timeout plus the reads, so a slow send can't be claimed twice. */
const SEND_LOCK_MS = 60_000;
const MAX_TEXT = 4000;

const ALPH = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const newRef = () => "C-" + [...randomBytes(6)].map((b) => ALPH[b % ALPH.length]).join("");
const subjectOf = (q: string) => {
  const s = q.replace(/\s+/g, " ").trim();
  return s.length > 90 ? s.slice(0, 87) + "..." : s || "Support conversation";
};

export type ConvState = { id: string; status: "open" | "resolved" };

/**
 * The open conversation a new message belongs to. An id that isn't this person's (or no longer exists)
 * starts a new one instead of failing, so nothing about other people's chats leaks. A resolved one refuses
 * new messages until it is reopened: the lock holds on the server, not just in the browser.
 */
export async function openConversation(userId: string, id?: string | null): Promise<{ id: string } | null> {
  if (!id) return null;
  const c = await db.pipConversation.findFirst({ where: { id, userId }, select: { id: true, status: true } });
  if (!c) return null;
  if (c.status === "resolved") throw new HttpError(409, "This conversation is resolved. Reopen it to keep chatting.", "RESOLVED");
  return { id: c.id };
}

/** Writes one question and Pip's answer. Creates the conversation on its first message. */
export async function recordTurn(o: { userId: string; conversation: { id: string } | null; question: string; answer: string; askedAt: Date; answeredAt?: Date }) {
  const at = o.answeredAt ?? new Date();
  // Same instant on both rows would make the order depend on ids: keep the answer at least 1 ms after.
  const answeredAt = at.getTime() > o.askedAt.getTime() ? at : new Date(o.askedAt.getTime() + 1);
  const messages = [
    { role: "user", text: o.question.slice(0, MAX_TEXT), createdAt: o.askedAt },
    { role: "pip", text: o.answer.slice(0, MAX_TEXT), createdAt: answeredAt },
  ];
  if (o.conversation) {
    await db.pipConversation.update({ where: { id: o.conversation.id }, data: { updatedAt: new Date(), messages: { create: messages } } });
    return o.conversation.id;
  }
  for (let i = 0; i < 5; i++) {
    try {
      const c = await db.pipConversation.create({ data: { ref: newRef(), userId: o.userId, subject: subjectOf(o.question), messages: { create: messages } }, select: { id: true } });
      return c.id;
    } catch (e: any) {
      if (e?.code !== "P2002") throw e;
    }
  }
  throw new Error("Could not start a conversation");
}

const when = (tz: string) => {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: tz });
  } catch {
    return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" });
  }
};

/** `to` is the account's own address, shown back to its owner only ("sent to you@example.com"). */
export type ResolveResult = { ok: true; status: "resolved"; to: string; already: boolean };

/**
 * Resolve & Send Transcript. Order matters: the conversation is only marked resolved AFTER the email
 * provider accepted the message. A failure leaves it open, says so, and can be retried.
 */
export async function resolveAndSend(userId: string, conversationId: string): Promise<ResolveResult> {
  const conv = await db.pipConversation.findFirst({ where: { id: conversationId, userId }, select: { id: true, ref: true, subject: true, status: true, sentAt: true, sentTo: true, createdAt: true } });
  if (!conv) throw new HttpError(404, "We couldn't find that conversation.", "NOT_FOUND");
  // Pressed twice, or a second tab: the transcript already went out for this resolve. Don't send another.
  if (conv.status === "resolved" && conv.sentAt) return { ok: true, status: "resolved", to: conv.sentTo ?? "", already: true };

  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true, timezone: true, emailVerifiedAt: true, emailVerifiedFor: true } });
  if (!user) throw new HttpError(404, "We couldn't find that conversation.", "NOT_FOUND");
  if (!isProven(user))
    throw new HttpError(403, "Your email address isn't verified yet, so we can't send the transcript there. Sign in once with an email code to verify it, then try again.", "UNVERIFIED");

  const total = await db.pipMessage.count({ where: { conversationId: conv.id } });
  if (!total) throw new HttpError(400, "There's nothing in this conversation to send yet.", "EMPTY");
  if (!(await limitShared(`pip-transcript:${userId}`, 6, 3600_000)).ok)
    throw new HttpError(429, "You've asked for a few transcripts already. Try again in an hour.", "RATE_LIMITED");

  // The claim: only one request at a time may send for this conversation. A crashed send frees itself after a minute.
  const now = new Date();
  const claim = await db.pipConversation.updateMany({
    where: { id: conv.id, userId, OR: [{ sendingAt: null }, { sendingAt: { lt: new Date(now.getTime() - SEND_LOCK_MS) } }], NOT: { status: "resolved", sentAt: { not: null } } },
    data: { sendingAt: now },
  });
  if (!claim.count) {
    const again = await db.pipConversation.findFirst({ where: { id: conv.id, userId }, select: { status: true, sentAt: true, sentTo: true } });
    if (again?.status === "resolved" && again.sentAt) return { ok: true, status: "resolved", to: again.sentTo ?? "", already: true };
    throw new HttpError(409, "Your transcript is already on its way. Give it a moment.", "SENDING");
  }

  let sent = false;
  try {
    const rows = await db.pipMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TRANSCRIPT_MAX_MESSAGES,
      select: { role: true, text: true, createdAt: true },
    });
    rows.reverse();
    const tz = user.timezone || "UTC";
    const f = when(tz);
    const html = templates.pipTranscript({
      name: user.name,
      ref: conv.ref,
      subject: conv.subject,
      date: f.format(conv.createdAt),
      tz,
      messages: rows.map((m) => ({ who: m.role === "user" ? "you" : "pip", time: f.format(m.createdAt), text: m.text })),
      earlier: Math.max(0, total - rows.length),
      url: `${env.APP_URL}/help`,
    });
    const mail = await sendEmail({ to: user.email, subject: TRANSCRIPT_SUBJECT, kind: "pip_transcript", html, private: true });
    // The mock provider only fills the admin Outbox. Fine while building; in production it would be a lie.
    const delivered = mail.ok && !(mail.status === "mocked" && env.NODE_ENV === "production");
    if (!delivered) {
      if (mail.error) console.error("[pip:transcript]", conv.ref, mail.error);
      throw new HttpError(502, "We couldn't send the email just now. Your conversation is still open and nothing was lost. Try again in a moment.", "SEND_FAILED");
    }
    sent = true;
    // The email is out. From here a database hiccup must never turn into "try again" (that would send it twice).
    const done = { status: "resolved", resolvedAt: new Date(), sentAt: new Date(), sentTo: user.email, sendingAt: null };
    await db.pipConversation.update({ where: { id: conv.id }, data: done }).catch(async (e) => {
      console.error("[pip:transcript] sent but not saved, retrying", conv.ref, e);
      await db.pipConversation.update({ where: { id: conv.id }, data: done }).catch((e2) => console.error("[pip:transcript] sent, still not saved", conv.ref, e2));
    });
    return { ok: true, status: "resolved", to: user.email, already: false };
  } catch (e) {
    // Keep the claim when the email already went: a retry then waits instead of sending a second copy.
    if (sent) return { ok: true, status: "resolved", to: user.email, already: false };
    await db.pipConversation.updateMany({ where: { id: conv.id, sendingAt: now }, data: { sendingAt: null } }).catch(() => {});
    if (e instanceof HttpError) throw e;
    console.error("[pip:transcript]", e);
    throw new HttpError(502, "We couldn't send the email just now. Your conversation is still open and nothing was lost. Try again in a moment.", "SEND_FAILED");
  }
}

/** Reopen Conversation: the chat takes messages again; resolving later sends a fresh transcript. */
export async function reopen(userId: string, conversationId: string): Promise<ConvState> {
  const r = await db.pipConversation.updateMany({ where: { id: conversationId, userId }, data: { status: "open", resolvedAt: null, sendingAt: null } });
  if (!r.count) throw new HttpError(404, "We couldn't find that conversation.", "NOT_FOUND");
  return { id: conversationId, status: "open" };
}
