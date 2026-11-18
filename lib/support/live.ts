import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { HttpError } from "../http";
import { cached, invalidate } from "../cache";
import { limitShared } from "../rate-limit";
import { adminEvent } from "../admin/route";
import type { AdminSession } from "../admin/auth";
import { ADMIN_ROLES, can, type AdminRole } from "../admin/perms";
import { nextSeqs, startConversation } from "./conversations";
import {
  ABANDON_MS,
  AGENT_ONLINE_MS,
  byPriority,
  CATEGORY_LABEL,
  classify,
  cleanText,
  CUSTOMER_ONLINE_MS,
  customerState,
  firstName,
  isClientId,
  isOnline,
  isTyping,
  LEFT_KEEP_MS,
  LIVE_CATEGORIES,
  LIVE_PRIORITIES,
  mean,
  median,
  NOTE_MAX,
  QUEUE_SEEN_MS,
  queueEta,
  startOfDay,
  SYS,
  sysText,
  type CustomerState,
  type LiveCategory,
  type LivePriority,
  type QueueEta,
  type SessionStatus,
  type WireMsg,
  type WireRole,
  conversationState,
  type ConversationState,
} from "./live-core";

/**
 * R1184 Live Assist: a person from the support team joins the customer's Pip chat.
 *
 * One messaging system: everything is a PipMessage in the customer's PipConversation (the same rows Pip writes,
 * the same transcript email). Both sides poll for "messages after N"; there is no second channel to keep in sync.
 *
 * Rules that hold on the server, whatever a browser does:
 * - Saved before acknowledged. A send returns only after its row (and its number) is committed.
 * - One order. Message numbers come from PipConversation.seq inside the same transaction as the row; the
 *   conversation row stays locked until commit, so number N is visible before N+1 can exist.
 * - No duplicates. A sender's client id is unique per conversation: a resend after a dropped connection
 *   returns the row that was already saved.
 * - One owner. Accept, assign, transfer, take over, return and resolve are conditional updates on what was
 *   read ("still waiting and nobody has it"); two specialists pressing Accept at once get one winner and one
 *   clear "already accepted". Locks are always taken session first, then conversation, so they can't deadlock.
 * - Customers only ever touch their own conversation (id AND userId). Notes and assignment history are staff
 *   only and never leave the admin API.
 * - Pip stays silent while a request is waiting or a specialist is in the chat (the chat route checks mode).
 */

type Tx = Prisma.TransactionClient;
const OPEN: SessionStatus[] = ["waiting", "active"];
const DAY = 24 * 3600_000;
/** Roles that answer live chats (perms.ts "live"). */
export const LIVE_ROLES: AdminRole[] = ADMIN_ROLES.filter((r) => can(r, "live"));

const NOT_FOUND = () => new HttpError(404, "We couldn't find that conversation.", "NOT_FOUND");
const GONE = () => new HttpError(404, "We couldn't find that chat. It may have been removed with the customer's account.", "NOT_FOUND");
const CHANGED = () => new HttpError(409, "Someone changed this chat a moment ago. Have a look and try again.", "CHANGED");
const ENDED = () => new HttpError(409, "This chat has already ended. Reopen it to talk to the customer again.", "ENDED");
const NOT_LIVE = () => new HttpError(409, "This chat is back with Pip, so the message wasn't sent to our support team.", "NOT_LIVE");

const MSG_SELECT = { id: true, seq: true, role: true, text: true, clientId: true, authorName: true, createdAt: true } as const;
type Row = { id: string; seq: number | null; role: string; text: string; clientId: string | null; authorName: string | null; createdAt: Date };

const wireRole = (role: string): WireRole => (role === "user" ? "user" : role === "agent" ? "agent" : role === "system" ? "system" : "pip");
/** The customer sees a specialist's first name only; staff see the full name. A client id goes back to its own side only. */
function wire(m: Row, side: "customer" | "agent"): WireMsg {
  const role = wireRole(m.role);
  const own = (side === "customer" && role === "user") || (side === "agent" && role === "agent");
  return { id: m.id, seq: m.seq, role, text: m.text, cid: own ? m.clientId : null, author: role === "agent" ? (side === "customer" ? firstName(m.authorName) : m.authorName || "Support") : null, at: m.createdAt.toISOString() };
}

/** One message with the next number. `conv` is written in the same update that hands out the number. */
async function post(tx: Tx, conversationId: string, m: { role: "user" | "agent" | "system"; text: string; clientId?: string | null; authorId?: string | null; authorName?: string | null }, conv: Record<string, unknown> = {}) {
  const [seq] = await nextSeqs(tx, conversationId, 1, conv);
  return tx.pipMessage.create({
    data: { conversationId, role: m.role, text: m.text, seq, clientId: m.clientId ?? null, authorId: m.authorId ?? null, authorName: m.authorName ?? null },
    select: MSG_SELECT,
  });
}

async function log(tx: Tx, sessionId: string, action: string, by: AdminSession | null, o: { fromId?: string | null; toId?: string | null; note?: string } = {}) {
  await tx.supportAssignment.create({
    data: { sessionId, action, fromId: o.fromId ?? null, toId: o.toId ?? null, byId: by?.id ?? null, byName: by?.name.slice(0, 80) ?? "Customer", note: (o.note ?? "").slice(0, 300) },
  });
}

/**
 * R1194: one structured line per handoff event (request, duplicate, accept, first_response, resolve, cancel,
 * notify_failed), so a support lead can follow one request through the server logs. Message text never goes in.
 */
export function handoffLog(event: string, data: Record<string, unknown>) {
  try {
    console.info("[live:handoff]", JSON.stringify({ event, at: new Date().toISOString(), ...data }));
  } catch {}
}

/** Every specialist action goes to the audit log too (who, what, which chat). Message text never does. */
async function audit(admin: AdminSession, action: string, sessionId: string, note = "", before?: unknown, after?: unknown) {
  await db.auditLog
    .create({
      data: {
        actor: admin.login.slice(0, 120),
        actorRole: admin.role,
        action: `live.${action}`,
        targetType: "live",
        targetId: sessionId,
        before: before === undefined ? null : JSON.stringify(before),
        after: after === undefined ? null : JSON.stringify(after),
        note: note.slice(0, 500),
      },
    })
    .catch((e) => console.error("[audit]", e));
}

const changed = () => {
  invalidate("live:");
};

/** Specialists whose console checked in recently and who aren't marked away. Cached briefly: every customer poll asks. */
export async function agentsOnline(now = Date.now()) {
  return cached("live:agents-online", 5_000, () =>
    db.adminUser.count({ where: { active: true, liveAway: false, role: { in: LIVE_ROLES }, liveSeenAt: { gt: new Date(now - AGENT_ONLINE_MS) } } }),
  );
}

let swept = 0;
/**
 * Closes waiting requests whose customer left (no check-in for ABANDON_MS): status cancelled, endedBy "system",
 * Pip back on the conversation. Conditional on status like every other closer, so an accept racing it wins or loses
 * cleanly. Runs from the console's queue poll, at most once a minute per instance.
 */
export async function sweepAbandoned(now = Date.now(), force = false) {
  if (!force && now - swept < 60_000) return 0;
  swept = now;
  const cut = new Date(now - ABANDON_MS);
  const rows = await db.supportSession.findMany({
    // R1205: a request the customer left a message on stays in the queue (for LEFT_KEEP_MS), browser or not.
    where: {
      status: "waiting",
      OR: [{ customerSeenAt: { lt: cut } }, { customerSeenAt: null, requestedAt: { lt: cut } }],
      history: { none: { action: "leave_message", createdAt: { gt: new Date(now - LEFT_KEEP_MS) } } },
    },
    select: { id: true, conversationId: true },
    take: 50,
  });
  let n = 0;
  for (const r of rows) {
    const done = await db.$transaction(async (tx) => {
      const u = await tx.supportSession.updateMany({ where: { id: r.id, status: "waiting" }, data: { status: "cancelled", endedAt: new Date(now), endedBy: "system", customerTypingAt: null, agentTypingAt: null } });
      if (!u.count) return false;
      const c = await tx.pipConversation.findUnique({ where: { id: r.conversationId }, select: { liveId: true } });
      if (c?.liveId === r.id) await post(tx, r.conversationId, { role: "system", text: sysText(SYS.cancelled) }, { mode: "ai", liveId: null });
      await log(tx, r.id, "cancel", null, { note: "Closed: the customer left while waiting" });
      return true;
    });
    if (done) n++;
  }
  if (n) changed();
  return n;
}

/** Waiting requests, for the sidebar badge. */
export async function waitingCount() {
  return cached("live:waiting", 10_000, () => db.supportSession.count({ where: { status: "waiting" } }));
}

// ---------------------------------------------------------------------------------------------------------
// Customer side. userId is always realUserId(user): the person signed in, never a workspace owner.
// ---------------------------------------------------------------------------------------------------------

async function ownConversation(userId: string, conversationId: string) {
  const c = await db.pipConversation.findFirst({ where: { id: conversationId, userId }, select: { id: true, mode: true, liveId: true, seq: true, status: true } });
  if (!c) throw NOT_FOUND();
  return c;
}

export type CustomerSnapshot = {
  conversationId: string;
  mode: string;
  state: CustomerState;
  /** R1194: the one authoritative name for where this conversation stands (AI_ASSISTED ... CANCELLED). */
  conversationState: ConversationState;
  session: { id: string; status: string; agent: string | null; requestedAt: string; acceptedAt: string | null; endedAt: string | null; canRate: boolean; rated: boolean } | null;
  position: number | null;
  agentsOnline: number | null;
  /** R1205: "1min" only while a specialist is online, nobody is ahead and the wait is under a minute (queueEta). */
  eta: QueueEta;
  /** R1205: how long this request has been waiting, by the server's clock (null unless waiting). */
  waitedMs: number | null;
  /** R1205: the last message number this customer had on screen, so a fresh tab counts only what is really new. */
  readUpTo: number;
  messages: WireMsg[];
  cursor: number;
  more: boolean;
  typing: string | null;
  receipts: { delivered: number; read: number };
};

/**
 * What the widget needs on each check: the state from real rows, messages after its cursor (or, without one,
 * from the start of the latest request), whether the specialist is typing, and receipts for its own messages.
 * Checking in counts as "delivered" up to what it fetched; `read` (sent while the chat is on screen) as "seen".
 */
export async function customerPoll(userId: string, o: { conversationId: string; after?: number | null; read?: number | null; now?: number }): Promise<CustomerSnapshot> {
  const now = o.now ?? Date.now();
  const conv = await ownConversation(userId, o.conversationId);
  const s = await db.supportSession.findFirst({
    where: { conversationId: conv.id },
    orderBy: { requestedAt: "desc" },
    select: { id: true, status: true, agentName: true, requestedAt: true, acceptedAt: true, endedAt: true, csat: true, agentTypingAt: true, agentDeliveredSeq: true, agentReadSeq: true, custDeliveredSeq: true, custReadSeq: true, customerSeenAt: true },
  });
  // Never past the last number handed out: a cursor from the future would mark unwritten messages as delivered.
  const after = o.after == null || !Number.isFinite(o.after) ? null : Math.min(conv.seq, Math.max(0, Math.floor(o.after)));
  const TAKE = 100;
  const rows =
    after != null && after >= conv.seq
      ? []
      : await db.pipMessage.findMany({
          where: { conversationId: conv.id, seq: { gt: after ?? 0 }, ...(after == null && s ? { createdAt: { gte: s.requestedAt } } : {}) },
          orderBy: { seq: "asc" },
          take: TAKE,
          select: MSG_SELECT,
        });
  const cursor = rows.length ? (rows[rows.length - 1].seq ?? 0) : (after ?? conv.seq);

  const open = !!s && (s.status === "waiting" || s.status === "active");
  const shown = s && (open || (s.status === "resolved" && conv.mode === "resolved")) ? s : null;
  const online = s?.status === "waiting" ? await agentsOnline(now) : null;
  const position = s?.status === "waiting" ? 1 + (await db.supportSession.count({ where: { status: "waiting", requestedAt: { lt: s.requestedAt }, customerSeenAt: { gt: new Date(now - QUEUE_SEEN_MS) } } })) : null;

  if (s && open) {
    // Receipts only move forward. Each write happens only when it changes something (most polls write nothing).
    const writes: Promise<unknown>[] = [];
    if (cursor > s.custDeliveredSeq) writes.push(db.supportSession.updateMany({ where: { id: s.id, custDeliveredSeq: { lt: cursor } }, data: { custDeliveredSeq: cursor } }));
    const read = o.read == null || !Number.isFinite(o.read) ? 0 : Math.min(Math.floor(o.read), conv.seq);
    if (read > s.custReadSeq) writes.push(db.supportSession.updateMany({ where: { id: s.id, custReadSeq: { lt: read } }, data: { custReadSeq: read } }));
    if (!s.customerSeenAt || now - s.customerSeenAt.getTime() > 10_000) writes.push(db.supportSession.update({ where: { id: s.id }, data: { customerSeenAt: new Date(now) } }));
    if (writes.length) await Promise.all(writes);
  }

  const state = customerState(shown, { agentsOnline: online ?? 1, now });
  const waitedMs = s?.status === "waiting" ? Math.max(0, now - s.requestedAt.getTime()) : null;
  return {
    conversationId: conv.id,
    mode: conv.mode,
    state,
    conversationState: conversationState(conv.mode, s?.status ?? null),
    session: s
      ? {
          id: s.id,
          status: s.status,
          agent: s.status === "waiting" || !s.agentName ? null : firstName(s.agentName),
          requestedAt: s.requestedAt.toISOString(),
          acceptedAt: s.acceptedAt?.toISOString() ?? null,
          endedAt: s.endedAt?.toISOString() ?? null,
          canRate: s.status === "resolved" && s.csat == null,
          rated: s.csat != null,
        }
      : null,
    position,
    agentsOnline: online,
    eta: queueEta({ state, agentsOnline: online, position, waitedMs }),
    waitedMs,
    readUpTo: s ? Math.max(s.custReadSeq, o.read == null || !Number.isFinite(o.read) ? 0 : Math.min(Math.floor(o.read), conv.seq)) : 0,
    messages: rows.map((m) => wire(m, "customer")),
    cursor,
    more: rows.length === TAKE,
    typing: s?.status === "active" && isTyping(s.agentTypingAt, now) ? firstName(s.agentName) : null,
    receipts: s ? { delivered: s.agentDeliveredSeq, read: s.agentReadSeq } : { delivered: 0, read: 0 },
  };
}

/**
 * R1194: the conversation a signed-in person is waiting in, or talking to a specialist in, if any. A new tab or
 * a restarted browser asks this once on open, so the queue place and the chat come back without the person
 * having to ask again (the server is the one source of truth; the browser only cached it).
 */
export async function resumeLive(userId: string): Promise<CustomerSnapshot | null> {
  const c = await db.pipConversation.findFirst({ where: { userId, mode: { in: ["waiting", "human"] }, liveId: { not: null } }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  return c ? customerPoll(userId, { conversationId: c.id }) : null;
}

class Already extends Error {}

/**
 * "Connect to a human". Idempotent: a second tap (or a second tab) returns the request already in the queue.
 * A resolved conversation is finished, so a new request starts a new conversation (the old one stays on record).
 * `message` is the customer's own words when Pip hasn't written any down yet; nothing a browser claims Pip said
 * is ever stored.
 */
export type HandoffSource = "chat" | "button";
export async function requestHuman(
  userId: string,
  o: { conversationId?: string | null; message?: unknown; cid?: unknown; source?: HandoffSource; intent?: unknown; repeat?: boolean },
): Promise<CustomerSnapshot & { created: boolean }> {
  const message = cleanText(o.message);
  const cid = isClientId(o.cid) ? o.cid : null;
  const source: HandoffSource = o.source ?? "button";
  const intent = cleanText(o.intent, 200) || message.slice(0, 200);
  let conv = o.conversationId ? await db.pipConversation.findFirst({ where: { id: o.conversationId, userId }, select: { id: true, status: true, mode: true, liveId: true } }) : null;
  // R1194: one open request per person, whichever conversation the words arrived in (this chat, a fresh chat after
  // a reload, another tab, the button after the words). Any request of theirs still open is the one they are in.
  const OPEN_SELECT = { id: true, status: true, conversationId: true } as const;
  const open =
    (conv?.liveId ? await db.supportSession.findFirst({ where: { id: conv.liveId, status: { in: OPEN } }, select: OPEN_SELECT }) : null) ??
    (await db.supportSession.findFirst({ where: { userId, status: { in: OPEN } }, orderBy: { createdAt: "desc" }, select: OPEN_SELECT }));
  if (open) {
    // Asked again while already in the queue (or already talking). The words still reach the specialist (saved in
    // the conversation that holds the request), the ask is counted and written down, and there is never a second
    // request or a second ticket. The widget shows "You're already in the support queue" once.
    if (message) await customerSend(userId, { conversationId: open.conversationId, text: message, cid }).catch(() => {});
    await Promise.all([
      db.supportSession.update({ where: { id: open.id }, data: { duplicates: { increment: 1 }, lastDuplicateAt: new Date() } }),
      log(db, open.id, "duplicate", null, { note: intent || `again via ${source}` }),
    ]).catch(() => {});
    handoffLog("duplicate", { userId, conversationId: open.conversationId, sessionId: open.id, status: open.status, source, repeat: !!o.repeat, sameConversation: conv?.liveId === open.id });
    return { ...(await customerPoll(userId, { conversationId: open.conversationId })), created: false };
  }
  if (!(await limitShared(`live-request:${userId}`, 6, 3600_000)).ok)
    throw new HttpError(429, "You've asked for our support team a few times in the last hour. Give it a little while, then ask again here.", "RATE_LIMITED");
  if (conv && (conv.status === "resolved" || conv.mode === "resolved")) conv = null;
  const convId = conv?.id ?? (await startConversation(userId, message || "Talk to our support team")).id;

  const recent = await db.pipMessage.findMany({ where: { conversationId: convId, role: "user" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 12, select: { text: true } });
  const words = [message, ...recent.map((r) => r.text)].filter(Boolean);
  const { category, priority } = classify(words);
  const preview = (message || recent[0]?.text || "").replace(/\s+/g, " ").slice(0, 200);

  // R1194: "create or reuse the existing support ticket". A ticket this customer already has open (last 14 days)
  // is linked, so the specialist sees it. No new ticket is opened here: the request itself is the record (one
  // row, one queue place). R1205: leaving a message no longer makes one either; the answer comes in this chat.
  const openTicket = await db.ticket.findFirst({ where: { userId, status: { not: "resolved" }, createdAt: { gt: new Date(Date.now() - 14 * DAY) } }, orderBy: { createdAt: "desc" }, select: { id: true, ref: true } });
  const created = await db
    .$transaction(async (tx) => {
      const s = await tx.supportSession.create({
        data: { conversationId: convId, userId, category, priority, preview, customerSeenAt: new Date(), unreadAgent: message ? 1 : 0, source, intentText: intent, ticketId: openTicket?.id ?? null },
        select: { id: true },
      });
      // The claim: only a conversation with no open request takes a new one. A racing second tap loses here.
      const took = await tx.pipConversation.updateMany({ where: { id: convId, userId, liveId: null }, data: { liveId: s.id, mode: "waiting" } });
      if (!took.count) throw new Already();
      // The customer's words first, then Pip's one confirmation line (the stored live.requested status).
      if (message) await post(tx, convId, { role: "user", text: message, clientId: cid });
      await post(tx, convId, { role: "system", text: sysText(SYS.requested) });
      await log(tx, s.id, "request", null, { note: `${CATEGORY_LABEL[category]} via ${source}${openTicket ? ` · ticket ${openTicket.ref}` : ""}` });
      return s;
    })
    .catch((e) => {
      if (e instanceof Already) return null;
      throw e;
    });
  if (!created) {
    // Lost the race to a second tap a moment earlier: the request is in the queue, and these words still go with it.
    if (message) await customerSend(userId, { conversationId: convId, text: message, cid }).catch(() => {});
    handoffLog("duplicate", { userId, conversationId: convId, source, race: true });
    return { ...(await customerPoll(userId, { conversationId: convId })), created: false };
  }
  changed();
  handoffLog("request", { userId, conversationId: convId, sessionId: created.id, source, category, priority, ticketId: openTicket?.id ?? null, agentsOnline: await agentsOnline() });
  const who = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  // The team's bell. A failure here never fails the request (it is already in the queue); it is logged for the diagnostics page.
  try {
    await adminEvent(
      priority === "urgent" ? "live_urgent" : "live_request",
      `${priority === "urgent" ? "Urgent live chat" : "Live chat request"}: ${who?.name || "a customer"}`,
      `${CATEGORY_LABEL[category]}${preview ? ` · ${preview.slice(0, 120)}` : ""}`,
      `/admin/live-assist?s=${created.id}`,
    );
  } catch (e) {
    handoffLog("notify_failed", { sessionId: created.id, error: e instanceof Error ? e.message : String(e) });
    await log(db, created.id, "notify_failed", null, { note: e instanceof Error ? e.message.slice(0, 200) : "notify failed" }).catch(() => {});
  }
  return { ...(await customerPoll(userId, { conversationId: convId })), created: true };
}

/** A customer message while waiting or connected. Returns the saved row (the same one again for a resend). */
export async function customerSend(userId: string, o: { conversationId: string; text: unknown; cid?: unknown }): Promise<{ message: WireMsg; duplicate: boolean }> {
  const text = cleanText(o.text);
  if (!text) throw new HttpError(400, "Write a message first.", "EMPTY");
  const cid = isClientId(o.cid) ? o.cid : null;
  const conv = await ownConversation(userId, o.conversationId);
  const again = async () => {
    if (!cid) return null;
    const dup = await db.pipMessage.findUnique({ where: { conversationId_clientId: { conversationId: conv.id, clientId: cid } }, select: MSG_SELECT });
    return dup ? { message: wire(dup, "customer"), duplicate: true } : null;
  };
  const dup = await again();
  if (dup) return dup;
  if (!conv.liveId || (conv.mode !== "waiting" && conv.mode !== "human")) throw NOT_LIVE();
  if (!(await limitShared(`live-send:${userId}`, 40, 60_000)).ok) throw new HttpError(429, "That's a lot of messages at once. Give it a few seconds.", "RATE_LIMITED");
  const liveId = conv.liveId;
  try {
    const m = await db.$transaction(async (tx) => {
      const now = new Date();
      const s = await tx.supportSession.updateMany({
        where: { id: liveId, userId, status: { in: OPEN } },
        data: { lastMessageAt: now, unreadAgent: { increment: 1 }, customerTypingAt: null, customerSeenAt: now, preview: text.replace(/\s+/g, " ").slice(0, 200) },
      });
      if (!s.count) throw NOT_LIVE();
      return post(tx, conv.id, { role: "user", text, clientId: cid });
    });
    changed();
    // R1205: words written while nobody is online are a message left for the team, same as Leave a message: the
    // request stays queued and the chat says the message is saved. With a specialist online it is just a message.
    if (conv.mode === "waiting" && (await agentsOnline()) < 1) await noteLeft(userId, conv.id, liveId).catch(() => {});
    return { message: wire(m, "customer"), duplicate: false };
  } catch (e: any) {
    if (e?.code === "P2002") {
      const d = await again();
      if (d) return d;
    }
    throw e;
  }
}

export async function customerTyping(userId: string, conversationId: string) {
  if (!(await limitShared(`live-typing:${userId}`, 30, 60_000)).ok) return { ok: false };
  const conv = await ownConversation(userId, conversationId);
  if (!conv.liveId) return { ok: false };
  const r = await db.supportSession.updateMany({ where: { id: conv.liveId, userId, status: { in: OPEN } }, data: { customerTypingAt: new Date(), customerSeenAt: new Date() } });
  return { ok: r.count > 0 };
}

/** "Cancel request" while waiting, or "End chat" once connected: the chat goes back to Pip. */
export async function cancelRequest(userId: string, conversationId: string) {
  const conv = await ownConversation(userId, conversationId);
  if (conv.liveId) {
    const liveId = conv.liveId;
    const ended = await db.$transaction(async (tx) => {
      const s = await tx.supportSession.findFirst({ where: { id: liveId, userId, status: { in: OPEN } }, select: { id: true, status: true, agentId: true } });
      if (!s) return false;
      const r = await tx.supportSession.updateMany({ where: { id: s.id, status: s.status }, data: { status: "cancelled", endedAt: new Date(), endedBy: "customer", customerTypingAt: null, agentTypingAt: null } });
      if (!r.count) return false;
      await post(tx, conv.id, { role: "system", text: sysText(s.status === "active" ? SYS.customerLeft : SYS.cancelled) }, { mode: "ai", liveId: null });
      await log(tx, s.id, "cancel", null, { fromId: s.agentId, note: s.status === "active" ? "Customer ended the chat" : "Customer cancelled the request" });
      return true;
    });
    if (ended) {
      changed();
      handoffLog("cancel", { userId, conversationId: conv.id, sessionId: liveId });
    }
  }
  return customerPoll(userId, { conversationId: conv.id });
}

/**
 * R1205: a message was left on a waiting request. Once per request: one "Your message is saved in this chat" line and
 * one leave_message history row (the abandoned-request sweep keeps these queued). Both checks run inside one
 * transaction on the session row, so two sends at once still write each only once. True when this call wrote them.
 */
async function noteLeft(userId: string, conversationId: string, liveId: string) {
  const said = await db.$transaction(async (tx) => {
    const s = await tx.supportSession.findFirst({ where: { id: liveId, userId, status: "waiting" }, select: { id: true, requestedAt: true } });
    if (!s) return false;
    await tx.supportSession.update({ where: { id: s.id }, data: { customerSeenAt: new Date() } });
    const before = await tx.pipMessage.findFirst({ where: { conversationId, role: "system", text: SYS.left, createdAt: { gte: s.requestedAt } }, select: { id: true } });
    const had = await tx.supportAssignment.findFirst({ where: { sessionId: s.id, action: "leave_message" }, select: { id: true } });
    if (!had) await log(tx, s.id, "leave_message", null, { note: "Left a message in the chat" });
    if (before) return false;
    await post(tx, conversationId, { role: "system", text: sysText(SYS.left) });
    return true;
  });
  if (said) {
    changed();
    handoffLog("leave", { userId, conversationId, sessionId: liveId });
  }
  return said;
}

/**
 * R1205 "Leave a message", when no specialist is free: the words go into this same chat (no ticket, no email),
 * the request stays in the queue even after the customer closes the tab, and a specialist answers right here.
 * One "Your message is saved in this chat" line per request. Needs a request that is still waiting.
 */
export async function leaveMessage(userId: string, o: { conversationId: string; text?: unknown; cid?: unknown }) {
  const conv = await ownConversation(userId, o.conversationId);
  if (!conv.liveId || conv.mode !== "waiting") throw NOT_LIVE();
  if (!(await limitShared(`live-leave:${userId}`, 10, 3600_000)).ok) throw new HttpError(429, "That's a lot of messages at once. A specialist will read the ones already in this chat.", "RATE_LIMITED");
  const liveId = conv.liveId;
  if (cleanText(o.text)) await customerSend(userId, { conversationId: conv.id, text: o.text, cid: o.cid });
  await noteLeft(userId, conv.id, liveId);
  return customerPoll(userId, { conversationId: conv.id });
}

/** One answer per resolved chat: 1 = helpful, 0 = not. */
export async function rate(userId: string, o: { conversationId: string; helpful: boolean }) {
  const conv = await ownConversation(userId, o.conversationId);
  const s = await db.supportSession.findFirst({ where: { conversationId: conv.id, userId, status: "resolved" }, orderBy: { requestedAt: "desc" }, select: { id: true, csat: true } });
  if (!s) throw new HttpError(409, "There's no finished chat with our support team to rate yet.", "NOTHING_TO_RATE");
  const r = await db.supportSession.updateMany({ where: { id: s.id, csat: null }, data: { csat: o.helpful ? 1 : 0 } });
  if (r.count) changed();
  return { ok: true, already: !r.count };
}

// ---------------------------------------------------------------------------------------------------------
// Specialist side. Every call comes through adminRoute("live", ...): signed-in admin with a live role.
// ---------------------------------------------------------------------------------------------------------

async function session(id: string) {
  const s = await db.supportSession.findUnique({ where: { id } });
  if (!s) throw GONE();
  return s;
}
const isOpen = (status: string) => status === "waiting" || status === "active";
/** An active chat belongs to whoever accepted it. A super admin may step in on anyone's. */
function mayHandle(admin: AdminSession, s: { status: string; agentId: string | null }) {
  if (s.status === "active" && s.agentId !== admin.id && admin.role !== "super")
    throw new HttpError(403, "This chat is with another specialist. Ask them to transfer it, or ask a super admin.", "NOT_YOURS");
}

export async function accept(admin: AdminSession, id: string) {
  const now = new Date();
  const won = await db.$transaction(async (tx) => {
    // The whole race is this one conditional update: still waiting, and nobody (or me) has it.
    const r = await tx.supportSession.updateMany({
      where: { id, status: "waiting", OR: [{ agentId: null }, { agentId: admin.id }] },
      data: { status: "active", agentId: admin.id, agentName: admin.name.slice(0, 80), acceptedAt: now },
    });
    if (r.count !== 1) return null;
    const s = await tx.supportSession.findUniqueOrThrow({ where: { id }, select: { conversationId: true } });
    await post(tx, s.conversationId, { role: "system", text: sysText(SYS.connected, firstName(admin.name)) }, { mode: "human" });
    await log(tx, id, "accept", admin, { toId: admin.id });
    return s;
  });
  if (!won) {
    const s = await db.supportSession.findUnique({ where: { id }, select: { status: true, agentId: true, agentName: true } });
    if (!s) throw GONE();
    if (s.status === "active" && s.agentId === admin.id) return { ok: true, already: true };
    if (s.status === "active") throw new HttpError(409, `${s.agentName || "Another specialist"} already accepted this chat.`, "TAKEN", { agent: s.agentName });
    if (s.status === "waiting") throw new HttpError(409, `This chat is assigned to ${s.agentName || "another specialist"}. Take it over if they can't get to it.`, "ASSIGNED", { agent: s.agentName });
    throw new HttpError(409, "This request isn't waiting any more. The customer may have gone back to Pip or left a message.", "ENDED");
  }
  changed();
  handoffLog("accept", { sessionId: id, agentId: admin.id, waitMs: Date.now() - (await db.supportSession.findUnique({ where: { id }, select: { requestedAt: true } }))!.requestedAt.getTime() });
  await audit(admin, "accept", id);
  return { ok: true, already: false };
}

/**
 * Assign (a waiting chat is reserved for someone) or transfer (an active one moves, and the customer is told
 * who joined). Conditional on the holder we read, so two people moving it at once can't both win.
 */
export async function assign(admin: AdminSession, id: string, toId: string, kind: "assign" | "transfer" = "assign") {
  const target = await db.adminUser.findFirst({ where: { id: toId, active: true }, select: { id: true, name: true, role: true } });
  if (!target || !can(target.role as AdminRole, "live")) throw new HttpError(400, "Pick a teammate who answers Live Assist chats.", "BAD_AGENT");
  const s = await session(id);
  if (!isOpen(s.status)) throw ENDED();
  if (kind === "transfer" && s.status !== "active") throw new HttpError(409, "Only a chat someone accepted can be transferred. Assign this one instead.", "NOT_ACTIVE");
  if (s.agentId === target.id) return { ok: true, already: true };
  mayHandle(admin, s);
  await db.$transaction(async (tx) => {
    const r = await tx.supportSession.updateMany({ where: { id, status: s.status, agentId: s.agentId }, data: { agentId: target.id, agentName: target.name.slice(0, 80), agentTypingAt: null } });
    if (!r.count) throw CHANGED();
    if (s.status === "active") await post(tx, s.conversationId, { role: "system", text: sysText(SYS.transferred, firstName(target.name)) });
    await log(tx, id, s.status === "active" ? "transfer" : "assign", admin, { fromId: s.agentId, toId: target.id });
  });
  changed();
  await audit(admin, s.status === "active" ? "transfer" : "assign", id, "", { agentId: s.agentId }, { agentId: target.id });
  return { ok: true, already: false };
}

/**
 * Take over: a waiting chat someone else was assigned, or an active one whose specialist went quiet. Support
 * can take an active chat only when its specialist is offline or away; a super admin always can.
 */
export async function takeover(admin: AdminSession, id: string) {
  const s = await session(id);
  if (!isOpen(s.status)) throw ENDED();
  if (s.status === "waiting" && (!s.agentId || s.agentId === admin.id)) return accept(admin, id);
  if (s.agentId === admin.id) return { ok: true, already: true };
  if (s.status === "active" && admin.role !== "super" && s.agentId) {
    const holder = await db.adminUser.findUnique({ where: { id: s.agentId }, select: { liveSeenAt: true, liveAway: true, active: true } });
    if (holder && holder.active && !holder.liveAway && isOnline(holder.liveSeenAt, AGENT_ONLINE_MS))
      throw new HttpError(403, `${s.agentName || "Another specialist"} is still in this chat. Ask them to transfer it to you.`, "HOLDER_ONLINE");
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    const r = await tx.supportSession.updateMany({
      where: { id, status: s.status, agentId: s.agentId },
      data: { status: "active", agentId: admin.id, agentName: admin.name.slice(0, 80), acceptedAt: s.acceptedAt ?? now, agentTypingAt: null },
    });
    if (!r.count) throw CHANGED();
    const code = s.status === "waiting" ? sysText(SYS.connected, firstName(admin.name)) : sysText(SYS.transferred, firstName(admin.name));
    await post(tx, s.conversationId, { role: "system", text: code }, s.status === "waiting" ? { mode: "human" } : {});
    await log(tx, id, "takeover", admin, { fromId: s.agentId, toId: admin.id });
  });
  changed();
  await audit(admin, "takeover", id, "", { agentId: s.agentId, status: s.status }, { agentId: admin.id, status: "active" });
  return { ok: true, already: false };
}

/** A specialist's reply. Only the specialist who has the chat can write in it. */
export async function agentSend(admin: AdminSession, id: string, o: { text: unknown; cid?: unknown }): Promise<{ message: WireMsg; duplicate: boolean }> {
  const text = cleanText(o.text);
  if (!text) throw new HttpError(400, "Write a reply first.", "EMPTY");
  const cid = isClientId(o.cid) ? o.cid : null;
  const s = await session(id);
  const again = async () => {
    if (!cid) return null;
    const dup = await db.pipMessage.findUnique({ where: { conversationId_clientId: { conversationId: s.conversationId, clientId: cid } }, select: MSG_SELECT });
    return dup ? { message: wire(dup, "agent"), duplicate: true } : null;
  };
  const dup = await again();
  if (dup) return dup;
  if (s.status === "waiting") throw new HttpError(409, "Accept this chat before replying.", "NOT_ACCEPTED");
  if (s.status !== "active") throw ENDED();
  if (s.agentId !== admin.id) throw new HttpError(403, `This chat is with ${s.agentName || "another specialist"}. Take it over to reply.`, "NOT_YOURS");
  if (!(await limitShared(`live-agent-send:${admin.id}`, 120, 60_000)).ok) throw new HttpError(429, "That's a lot of replies at once. Give it a few seconds.", "RATE_LIMITED");
  try {
    const m = await db.$transaction(async (tx) => {
      const now = new Date();
      const r = await tx.supportSession.updateMany({ where: { id, status: "active", agentId: admin.id }, data: { lastMessageAt: now, agentTypingAt: null, preview: text.replace(/\s+/g, " ").slice(0, 200), unreadAgent: 0 } });
      if (!r.count) throw CHANGED();
      const msg = await post(tx, s.conversationId, { role: "agent", text, clientId: cid, authorId: admin.id, authorName: admin.name.slice(0, 80) });
      // Replying means everything before it was seen. First response time is set once, by the first reply.
      await tx.supportSession.update({ where: { id }, data: { agentDeliveredSeq: msg.seq ?? 0, agentReadSeq: msg.seq ?? 0 } });
      const first = await tx.supportSession.updateMany({ where: { id, firstResponseAt: null }, data: { firstResponseAt: now } });
      if (first.count) handoffLog("first_response", { sessionId: id, agentId: admin.id });
      return msg;
    });
    changed();
    return { message: wire(m, "agent"), duplicate: false };
  } catch (e: any) {
    if (e?.code === "P2002") {
      const d = await again();
      if (d) return d;
    }
    throw e;
  }
}

export async function agentTyping(admin: AdminSession, id: string) {
  const r = await db.supportSession.updateMany({ where: { id, status: "active", agentId: admin.id }, data: { agentTypingAt: new Date() } });
  return { ok: r.count > 0 };
}

/** Internal note: staff only. Never sent to the customer and never in a transcript. */
export async function addNote(admin: AdminSession, id: string, body: unknown) {
  const text = cleanText(body, NOTE_MAX);
  if (!text) throw new HttpError(400, "Write the note first.", "EMPTY");
  await session(id);
  const n = await db.supportNote.create({ data: { sessionId: id, authorId: admin.id, authorName: admin.name.slice(0, 80), body: text }, select: { id: true, authorName: true, body: true, createdAt: true } });
  await audit(admin, "note", id);
  return { ok: true, note: { id: n.id, author: n.authorName, body: n.body, at: n.createdAt.toISOString() } };
}

export async function setPriority(admin: AdminSession, id: string, priority: unknown) {
  if (!LIVE_PRIORITIES.includes(priority as LivePriority)) throw new HttpError(400, "Priority is normal, high or urgent.", "BAD_PRIORITY");
  const s = await session(id);
  if (s.priority === priority) return { ok: true, already: true };
  await db.$transaction(async (tx) => {
    await tx.supportSession.update({ where: { id }, data: { priority: priority as string } });
    await log(tx, id, "priority", admin, { note: `${s.priority} to ${priority}` });
  });
  changed();
  await audit(admin, "priority", id, "", { priority: s.priority }, { priority });
  return { ok: true, already: false };
}

export async function setCategory(admin: AdminSession, id: string, category: unknown) {
  if (!LIVE_CATEGORIES.includes(category as LiveCategory)) throw new HttpError(400, "Pick one of the categories.", "BAD_CATEGORY");
  const s = await session(id);
  if (s.category === category) return { ok: true, already: true };
  await db.supportSession.update({ where: { id }, data: { category: category as string } });
  changed();
  await audit(admin, "category", id, "", { category: s.category }, { category });
  return { ok: true, already: false };
}

/** Back to Pip: the request ends, the customer is told Pip is back, and Pip answers again. */
export async function returnToPip(admin: AdminSession, id: string) {
  const s = await session(id);
  if (!isOpen(s.status)) throw ENDED();
  mayHandle(admin, s);
  await db.$transaction(async (tx) => {
    const r = await tx.supportSession.updateMany({ where: { id, status: s.status, agentId: s.agentId }, data: { status: "returned", endedAt: new Date(), endedBy: admin.id, agentTypingAt: null, customerTypingAt: null } });
    if (!r.count) throw CHANGED();
    await post(tx, s.conversationId, { role: "system", text: sysText(SYS.pipBack) }, { mode: "ai", liveId: null });
    await log(tx, id, "return_pip", admin, { fromId: s.agentId });
  });
  changed();
  await audit(admin, "return_pip", id);
  return { ok: true };
}

/** Resolve (the console asks to confirm first). Keeps who and when; the conversation is resolved, never deleted. */
export async function resolve(admin: AdminSession, id: string) {
  const s = await session(id);
  if (!isOpen(s.status)) throw ENDED();
  mayHandle(admin, s);
  const now = new Date();
  await db.$transaction(async (tx) => {
    const r = await tx.supportSession.updateMany({ where: { id, status: s.status, agentId: s.agentId }, data: { status: "resolved", endedAt: now, endedBy: admin.id, agentTypingAt: null, customerTypingAt: null } });
    if (!r.count) throw CHANGED();
    // The customer's own "email me the transcript" still works afterwards: no transcript went out for this resolve yet.
    await post(tx, s.conversationId, { role: "system", text: sysText(SYS.resolved) }, { mode: "resolved", liveId: null, status: "resolved", resolvedAt: now, sentAt: null, sentTo: null, sendingAt: null });
    await log(tx, id, "resolve", admin, { fromId: s.agentId });
  });
  changed();
  handoffLog("resolve", { sessionId: id, agentId: admin.id, conversationId: s.conversationId });
  await audit(admin, "resolve", id);
  return { ok: true };
}

/** Reopen: a new session on the same conversation, active with whoever reopened it. The old one stays as it was. */
export async function reopenSession(admin: AdminSession, id: string) {
  const s = await session(id);
  if (isOpen(s.status)) throw new HttpError(409, "This chat is still open.", "OPEN");
  const conv = await db.pipConversation.findUnique({ where: { id: s.conversationId }, select: { id: true, liveId: true } });
  if (!conv) throw GONE();
  if (conv.liveId) throw new HttpError(409, "This customer already has an open chat in this conversation. Open that one instead.", "HAS_OPEN", { sessionId: conv.liveId });
  const now = new Date();
  const n = await db.$transaction(async (tx) => {
    const created = await tx.supportSession.create({
      data: { conversationId: s.conversationId, userId: s.userId, status: "active", priority: s.priority, category: s.category, agentId: admin.id, agentName: admin.name.slice(0, 80), requestedAt: now, acceptedAt: now, preview: s.preview },
      select: { id: true },
    });
    const took = await tx.pipConversation.updateMany({ where: { id: s.conversationId, liveId: null }, data: { liveId: created.id, mode: "human", status: "open", resolvedAt: null, sendingAt: null } });
    if (!took.count) throw CHANGED();
    await post(tx, s.conversationId, { role: "system", text: sysText(SYS.reopened, firstName(admin.name)) });
    await log(tx, created.id, "reopen", admin, { toId: admin.id, note: "Reopened from an earlier chat" });
    await log(tx, id, "reopen", admin, { toId: admin.id, note: "Continued in a new chat" });
    return created;
  });
  changed();
  await audit(admin, "reopen", n.id, `from ${id}`);
  return { ok: true, sessionId: n.id };
}

/** The console checks in while open. `away` hides this specialist from "someone is online". */
export async function heartbeat(admin: AdminSession, o: { away?: boolean } = {}) {
  const now = Date.now();
  const me = await db.adminUser.findUnique({ where: { id: admin.id }, select: { liveSeenAt: true, liveAway: true } });
  if (!me) return { away: false };
  const data: { liveSeenAt?: Date; liveAway?: boolean } = {};
  if (!me.liveSeenAt || now - me.liveSeenAt.getTime() > 20_000) data.liveSeenAt = new Date(now);
  if (typeof o.away === "boolean" && o.away !== me.liveAway) data.liveAway = o.away;
  if (Object.keys(data).length) {
    await db.adminUser.update({ where: { id: admin.id }, data });
    // Coming online or changing away is something customers should see straight away.
    if (!isOnline(me.liveSeenAt, AGENT_ONLINE_MS, now) || data.liveAway !== undefined) invalidate("live:agents-online");
  }
  return { away: data.liveAway ?? me.liveAway };
}

export type QueueFilter = "open" | "waiting" | "active" | "mine" | "unassigned" | "resolved" | "all";
export type QueueSort = "priority" | "oldest" | "newest" | "activity";
export const QUEUE_FILTERS: QueueFilter[] = ["open", "waiting", "active", "mine", "unassigned", "resolved", "all"];
export const QUEUE_SORTS: QueueSort[] = ["priority", "oldest", "newest", "activity"];

const safeAvatar = (a: string | null) => (a && /^(https:\/\/|\/)/.test(a) ? a.slice(0, 500) : null);

export type QueueRow = {
  id: string;
  conversationId: string;
  status: string;
  priority: string;
  category: string;
  agentId: string | null;
  agentName: string | null;
  requestedAt: string;
  acceptedAt: string | null;
  endedAt: string | null;
  lastMessageAt: string;
  waitMs: number;
  unread: number;
  preview: string;
  online: boolean;
  typing: boolean;
  csat: number | null;
  customer: { id: string; name: string; email: string; avatar: string | null } | null;
};

export async function queue(admin: AdminSession, o: { filter?: string | null; sort?: string | null; category?: string | null; priority?: string | null; now?: number } = {}) {
  const now = o.now ?? Date.now();
  await sweepAbandoned(now).catch((e) => console.error("[live] sweep", e));
  const filter = (QUEUE_FILTERS.includes(o.filter as QueueFilter) ? o.filter : "open") as QueueFilter;
  const sort = (QUEUE_SORTS.includes(o.sort as QueueSort) ? o.sort : "priority") as QueueSort;
  const today = startOfDay("Asia/Kolkata", new Date(now));
  const WHERE: Record<QueueFilter, Prisma.SupportSessionWhereInput> = {
    open: { status: { in: OPEN } },
    waiting: { status: "waiting" },
    active: { status: "active" },
    mine: { status: { in: OPEN }, agentId: admin.id },
    unassigned: { status: "waiting", agentId: null },
    resolved: { status: "resolved", endedAt: { gte: new Date(now - 30 * DAY) } },
    all: { requestedAt: { gte: new Date(now - 30 * DAY) } },
  };
  const where: Prisma.SupportSessionWhereInput = {
    ...WHERE[filter],
    ...(LIVE_CATEGORIES.includes(o.category as LiveCategory) ? { category: o.category as string } : {}),
    ...(LIVE_PRIORITIES.includes(o.priority as LivePriority) ? { priority: o.priority as string } : {}),
  };
  const [rows, grouped, mine, unassigned, resolvedToday, agents] = await Promise.all([
    db.supportSession.findMany({
      where,
      orderBy: filter === "resolved" ? { endedAt: "desc" } : filter === "all" ? { requestedAt: "desc" } : { requestedAt: "asc" },
      take: 100,
      select: { id: true, conversationId: true, userId: true, status: true, priority: true, category: true, agentId: true, agentName: true, requestedAt: true, acceptedAt: true, endedAt: true, lastMessageAt: true, unreadAgent: true, preview: true, customerSeenAt: true, customerTypingAt: true, csat: true },
    }),
    db.supportSession.groupBy({ by: ["status"], where: { status: { in: OPEN } }, _count: { _all: true } }),
    db.supportSession.count({ where: { status: { in: OPEN }, agentId: admin.id } }),
    db.supportSession.count({ where: { status: "waiting", agentId: null } }),
    db.supportSession.count({ where: { status: "resolved", endedAt: { gte: today } } }),
    db.adminUser.findMany({ where: { active: true, role: { in: LIVE_ROLES } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, liveSeenAt: true, liveAway: true } }),
  ]);
  const users = rows.length ? await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true, email: true, avatar: true } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const count = (st: string) => grouped.find((g) => g.status === st)?._count._all ?? 0;
  const items: QueueRow[] = rows.map((r) => {
    const u = byId.get(r.userId);
    const end = r.acceptedAt ?? (isOpen(r.status) ? new Date(now) : (r.endedAt ?? new Date(now)));
    return {
      id: r.id,
      conversationId: r.conversationId,
      status: r.status,
      priority: r.priority,
      category: r.category,
      agentId: r.agentId,
      agentName: r.agentName,
      requestedAt: r.requestedAt.toISOString(),
      acceptedAt: r.acceptedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      lastMessageAt: r.lastMessageAt.toISOString(),
      waitMs: Math.max(0, end.getTime() - r.requestedAt.getTime()),
      unread: r.unreadAgent,
      preview: r.preview,
      online: isOpen(r.status) && isOnline(r.customerSeenAt, CUSTOMER_ONLINE_MS, now),
      typing: isOpen(r.status) && isTyping(r.customerTypingAt, now),
      csat: r.csat,
      customer: u ? { id: u.id, name: u.name, email: u.email, avatar: safeAvatar(u.avatar) } : null,
    };
  });
  if (sort === "priority" && filter !== "resolved" && filter !== "all") items.sort(byPriority);
  else if (sort === "oldest") items.sort((a, b) => +new Date(a.requestedAt) - +new Date(b.requestedAt));
  else if (sort === "newest") items.sort((a, b) => +new Date(b.requestedAt) - +new Date(a.requestedAt));
  else if (sort === "activity") items.sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt));
  return {
    filter,
    sort,
    items,
    counts: { waiting: count("waiting"), active: count("active"), mine, unassigned, resolvedToday },
    agents: agents.map((a) => ({ id: a.id, name: a.name, role: a.role, online: !a.liveAway && isOnline(a.liveSeenAt, AGENT_ONLINE_MS, now), away: a.liveAway, me: a.id === admin.id })),
    me: { id: admin.id, name: admin.name, role: admin.role },
  };
}

/**
 * One chat for the console: messages (the recent history on first open, then only "after N"), staff notes and
 * history, and who the customer is. Customer context is plain facts: no tokens, no secrets, nothing from a
 * connected account beyond platform, handle and status. Opening it as the specialist who has it moves the
 * customer's "delivered" and, while on screen (`read`), "seen".
 */
export async function detail(admin: AdminSession, id: string, o: { after?: number | null; read?: boolean; now?: number } = {}) {
  const now = o.now ?? Date.now();
  const s = await db.supportSession.findUnique({
    where: { id },
    include: { notes: { orderBy: { createdAt: "asc" }, take: 200 }, history: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
  if (!s) throw GONE();
  const conv = await db.pipConversation.findUnique({ where: { id: s.conversationId }, select: { id: true, ref: true, subject: true, mode: true, liveId: true, seq: true, createdAt: true } });
  if (!conv) throw GONE();
  const after = o.after == null || !Number.isFinite(o.after) ? null : Math.min(conv.seq, Math.max(0, Math.floor(o.after)));
  const rows =
    after == null
      ? (await db.pipMessage.findMany({ where: { conversationId: conv.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200, select: MSG_SELECT })).reverse()
      : after >= conv.seq
        ? []
        : await db.pipMessage.findMany({ where: { conversationId: conv.id, seq: { gt: after } }, orderBy: { seq: "asc" }, take: 200, select: MSG_SELECT });
  const cursor = after == null ? conv.seq : rows.length ? Math.max(after, ...rows.map((r) => r.seq ?? 0)) : after;

  const mine = s.status === "active" && s.agentId === admin.id;
  if (mine) {
    const writes: Promise<unknown>[] = [];
    if (cursor > s.agentDeliveredSeq) writes.push(db.supportSession.updateMany({ where: { id, agentDeliveredSeq: { lt: cursor } }, data: { agentDeliveredSeq: cursor } }));
    if (o.read && (cursor > s.agentReadSeq || s.unreadAgent > 0)) writes.push(db.supportSession.updateMany({ where: { id, agentReadSeq: { lte: cursor } }, data: { agentReadSeq: cursor, unreadAgent: 0 } }));
    if (writes.length) {
      await Promise.all(writes);
      changed();
    }
  }

  const full = after == null;
  const ctx = full
    ? await Promise.all([
        db.user.findUnique({ where: { id: s.userId }, select: { id: true, name: true, email: true, avatar: true, createdAt: true, timezone: true, lastSeenAt: true, locCountry: true } }),
        db.subscription.findFirst({
          where: { userId: s.userId, status: "active", currentPeriodEnd: { gt: new Date(now) } },
          orderBy: { currentPeriodEnd: "desc" },
          select: { provider: true, interval: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, plan: { select: { name: true } } },
        }),
        db.socialAccount.findMany({ where: { userId: s.userId }, orderBy: { createdAt: "asc" }, take: 20, select: { platform: true, username: true, status: true } }),
        db.ticket.findMany({ where: { userId: s.userId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, ref: true, subject: true, status: true, priority: true, createdAt: true } }),
        db.supportSession.findMany({ where: { userId: s.userId, id: { not: s.id } }, orderBy: { requestedAt: "desc" }, take: 5, select: { id: true, status: true, category: true, agentName: true, requestedAt: true, endedAt: true, csat: true } }),
      ])
    : null;
  const endedBy = s.endedBy && s.endedBy !== "customer" && s.endedBy !== "system" ? await db.adminUser.findUnique({ where: { id: s.endedBy }, select: { name: true } }) : null;

  return {
    session: {
      id: s.id,
      conversationId: s.conversationId,
      status: s.status,
      priority: s.priority,
      category: s.category,
      agentId: s.agentId,
      agentName: s.agentName,
      requestedAt: s.requestedAt.toISOString(),
      acceptedAt: s.acceptedAt?.toISOString() ?? null,
      firstResponseAt: s.firstResponseAt?.toISOString() ?? null,
      endedAt: s.endedAt?.toISOString() ?? null,
      endedBy: s.endedBy === "customer" ? "The customer" : s.endedBy === "system" ? "Outlly" : (endedBy?.name ?? null),
      ticketId: s.ticketId,
      csat: s.csat,
      unread: s.unreadAgent,
      waitMs: Math.max(0, (s.acceptedAt ?? (isOpen(s.status) ? new Date(now) : (s.endedAt ?? new Date(now)))).getTime() - s.requestedAt.getTime()),
      // R1194 handoff diagnostics: how it started, the words, repeats while waiting, and the conversation's state name.
      handoff: {
        source: s.source,
        intent: s.intentText,
        duplicates: s.duplicates,
        lastDuplicateAt: s.lastDuplicateAt?.toISOString() ?? null,
        firstResponseMs: s.firstResponseAt ? Math.max(0, s.firstResponseAt.getTime() - s.requestedAt.getTime()) : null,
        state: conversationState(conv.liveId === s.id ? conv.mode : s.status === "resolved" ? "resolved" : "ai", s.status),
        notifyFailed: s.history.some((h) => h.action === "notify_failed"),
      },
    },
    conversation: { id: conv.id, ref: conv.ref, subject: conv.subject, mode: conv.mode, current: conv.liveId === s.id, openSessionId: conv.liveId },
    messages: rows.map((m) => wire(m, "agent")),
    cursor,
    full,
    mine,
    typing: isOpen(s.status) && isTyping(s.customerTypingAt, now),
    online: isOpen(s.status) && isOnline(s.customerSeenAt, CUSTOMER_ONLINE_MS, now),
    receipts: { delivered: s.custDeliveredSeq, read: s.custReadSeq },
    notes: s.notes.map((n) => ({ id: n.id, author: n.authorName, body: n.body, at: n.createdAt.toISOString() })),
    history: s.history.map((h) => ({ id: h.id, action: h.action, by: h.byName, note: h.note, at: h.createdAt.toISOString() })),
    customer: ctx ? customerContext(ctx) : null,
  };
}

type Ctx = [
  { id: string; name: string; email: string; avatar: string | null; createdAt: Date; timezone: string; lastSeenAt: Date | null; locCountry: string | null } | null,
  { provider: string; interval: string; currentPeriodEnd: Date; cancelAtPeriodEnd: boolean; plan: { name: string } } | null,
  { platform: string; username: string; status: string }[],
  { id: string; ref: string; subject: string; status: string; priority: string; createdAt: Date }[],
  { id: string; status: string; category: string; agentName: string | null; requestedAt: Date; endedAt: Date | null; csat: number | null }[],
];
function customerContext([u, sub, accounts, tickets, past]: Ctx) {
  return {
    user: u ? { id: u.id, name: u.name, email: u.email, avatar: safeAvatar(u.avatar), createdAt: u.createdAt.toISOString(), timezone: u.timezone, lastSeenAt: u.lastSeenAt?.toISOString() ?? null, country: u.locCountry } : null,
    plan: sub ? { name: sub.plan.name, interval: sub.interval, gift: sub.provider === "beta" || sub.provider === "referral", renews: sub.currentPeriodEnd.toISOString(), cancelling: sub.cancelAtPeriodEnd } : null,
    accounts,
    tickets: tickets.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
    past: past.map((p) => ({ ...p, requestedAt: p.requestedAt.toISOString(), endedAt: p.endedAt?.toISOString() ?? null })),
  };
}

export const ANALYTICS_DAYS = [1, 7, 30, 90] as const;
const stat = (xs: number[]) => ({ n: xs.length, median: median(xs), mean: mean(xs) });

/** Reports from real rows only. Wait = until accepted, first response = until the first reply, resolution = until resolved. */
export async function analytics(o: { days?: number | null; now?: number } = {}) {
  const now = o.now ?? Date.now();
  const want = o.days ?? 7;
  const days = (ANALYTICS_DAYS as readonly number[]).includes(want) ? want : 7;
  const since = days === 1 ? startOfDay("Asia/Kolkata", new Date(now)) : new Date(now - days * DAY);
  const CAP = 5000;
  const rows = await db.supportSession.findMany({
    where: { requestedAt: { gte: since } },
    orderBy: { requestedAt: "desc" },
    take: CAP,
    select: { status: true, agentId: true, agentName: true, requestedAt: true, acceptedAt: true, firstResponseAt: true, endedAt: true, csat: true },
  });
  const by = (st: string) => rows.filter((r) => r.status === st).length;
  const ms = (a: Date | null, b: Date) => (a ? a.getTime() - b.getTime() : null);
  const keep = (xs: (number | null)[]) => xs.filter((x): x is number => x != null && x >= 0);
  const rated = rows.filter((r) => r.csat != null);
  const helpful = rated.filter((r) => r.csat === 1).length;
  type Agent = { agentId: string; name: string; handled: number; resolved: number; first: number[]; resolution: number[]; rated: number; helpful: number };
  const agents = new Map<string, Agent>();
  for (const r of rows) {
    if (!r.agentId) continue;
    const a = agents.get(r.agentId) ?? { agentId: r.agentId, name: r.agentName || "Specialist", handled: 0, resolved: 0, first: [], resolution: [], rated: 0, helpful: 0 };
    a.handled++;
    const f = ms(r.firstResponseAt, r.requestedAt);
    if (f != null && f >= 0) a.first.push(f);
    if (r.status === "resolved") {
      a.resolved++;
      const t = ms(r.endedAt, r.requestedAt);
      if (t != null && t >= 0) a.resolution.push(t);
    }
    if (r.csat != null) {
      a.rated++;
      if (r.csat === 1) a.helpful++;
    }
    agents.set(r.agentId, a);
  }
  return {
    days,
    since: since.toISOString(),
    truncated: rows.length === CAP,
    totals: {
      total: rows.length,
      waiting: by("waiting"),
      active: by("active"),
      resolved: by("resolved"),
      unresolved: by("waiting") + by("active"),
      cancelled: by("cancelled"),
      returned: by("returned"),
      ticket: by("ticket"),
    },
    wait: stat(keep(rows.map((r) => ms(r.acceptedAt, r.requestedAt)))),
    firstResponse: stat(keep(rows.map((r) => ms(r.firstResponseAt, r.requestedAt)))),
    resolution: stat(keep(rows.filter((r) => r.status === "resolved").map((r) => ms(r.endedAt, r.requestedAt)))),
    csat: { rated: rated.length, helpful, pct: rated.length ? Math.round((100 * helpful) / rated.length) : null },
    agents: [...agents.values()]
      .sort((a, b) => b.handled - a.handled)
      .map((a) => ({ agentId: a.agentId, name: a.name, handled: a.handled, resolved: a.resolved, firstResponse: median(a.first), resolution: median(a.resolution), rated: a.rated, helpful: a.helpful })),
  };
}
