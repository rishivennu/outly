import "server-only";
import type { DmThread, SocialAccount } from "@prisma/client";
import { db } from "../db";
import { inScope, type Scope } from "../profiles-core";
import { decrypt, encrypt } from "../crypto";
import { HttpError } from "../http";
import { PLATFORM_META } from "../domain";
import { liveAccount } from "../live/account";
import { isPracticeAccount } from "../social/registry";
import { dmsOn } from "../social/keys";
import { asPublisherError, type AccountContext } from "../social/types";
import { DM_MAX_CHARS, DM_PLATFORMS, fetchProfile, isDmPlatform, listConversations, REPLY_WINDOW_MS, sendText, WindowClosedError, type DmPlatform, type RemoteThread } from "./meta";
import type { DmEvent } from "./webhook";
import { dmFailure } from "./errors";
import { clampTake, decodeCursor, encodeCursor, MESSAGE_PAGE, olderThan, THREAD_PAGE, THREAD_PAGE_MAX } from "./paging";
import { noticeNewMessage } from "../notify-events";

/**
 * Direct messages (1031): storage and the rules around it.
 *  - Webhooks (and Refresh) write here; the inbox only ever reads our copy, so opening it costs no API calls.
 *  - Message text and the thread preview are encrypted at rest, like tokens.
 *  - Meta allows a reply for 24 hours after the person's last message. We check before sending
 *    and also map Meta's own refusal, because our clock and theirs can disagree by a few seconds.
 */

const SNIPPET = 140;
const isClash = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";
const safeDecrypt = (v: string | null | undefined) => {
  if (!v) return "";
  try {
    return decrypt(v);
  } catch {
    return "";
  }
};

type Att = { type: string; url: string | null };

function preview(text: string, attachments: Att[], direction: "in" | "out") {
  const base = text.trim() || (attachments.length ? (attachments[0].type === "image" ? "Sent a photo" : attachments[0].type === "video" ? "Sent a video" : "Sent an attachment") : "");
  return (direction === "out" ? `You: ${base}` : base).slice(0, SNIPPET);
}

export function windowState(t: Pick<DmThread, "lastInboundAt">, now = Date.now()) {
  const ends = t.lastInboundAt ? t.lastInboundAt.getTime() + REPLY_WINDOW_MS : 0;
  return { canReply: ends > now, windowEndsAt: ends ? new Date(ends).toISOString() : null };
}

/* ------------------------------------------------------------------ ingest */

interface StoreMsg {
  mid: string | null;
  direction: "in" | "out";
  text: string;
  attachments: Att[];
  sentAt: Date;
  sentById?: string | null;
}

/** Insert one message once. Returns true when it was new. */
async function storeMessage(threadId: string, m: StoreMsg): Promise<boolean> {
  try {
    await db.dmMessage.create({
      data: {
        threadId,
        platformMessageId: m.mid,
        direction: m.direction,
        text: encrypt(m.text.slice(0, 4000)),
        attachments: m.attachments.length ? JSON.stringify(m.attachments.slice(0, 10)) : null,
        sentAt: m.sentAt,
        sentById: m.sentById ?? null,
      },
    });
    return true;
  } catch (err) {
    if (isClash(err)) return false; // webhook retry, or the echo of a reply we already stored
    throw err;
  }
}

/** Fold the newest message into the thread row (preview, times, unread). Older messages never move it backwards. */
async function touchThread(t: DmThread, m: StoreMsg, countUnread: boolean) {
  const newer = m.sentAt.getTime() >= t.lastMessageAt.getTime();
  const data: Record<string, unknown> = {};
  if (newer) {
    data.lastMessageAt = m.sentAt;
    data.snippet = encrypt(preview(m.text, m.attachments, m.direction));
  }
  if (m.direction === "in" && (!t.lastInboundAt || m.sentAt > t.lastInboundAt)) data.lastInboundAt = m.sentAt;
  if (m.direction === "in" && countUnread) data.unread = { increment: 1 };
  // Archive only hides a thread in Outlly: the person writing again brings it back.
  if (m.direction === "in" && t.archivedAt && m.sentAt > t.archivedAt) data.archivedAt = null;
  // The creator answered from the Instagram or Messenger app: they have seen it.
  if (m.direction === "out" && newer) data.unread = 0;
  if (Object.keys(data).length) await db.dmThread.update({ where: { id: t.id }, data });
}

async function threadFor(acct: SocialAccount, personId: string, hint?: Partial<Pick<RemoteThread, "participantName" | "participantHandle" | "conversationId">>, firstAt = new Date(), lookup = true) {
  const existing = await db.dmThread.findUnique({ where: { accountId_participantId: { accountId: acct.id, participantId: personId } } });
  if (existing) {
    // Fill what an earlier webhook could not (no profile lookup there when Meta sends a burst).
    const fill: Record<string, string> = {};
    if (hint?.conversationId && !existing.platformThreadId) fill.platformThreadId = hint.conversationId;
    if (hint?.participantName && !existing.participantName) fill.participantName = hint.participantName;
    if (hint?.participantHandle && !existing.participantHandle) fill.participantHandle = hint.participantHandle;
    if (Object.keys(fill).length) await db.dmThread.update({ where: { id: existing.id }, data: fill }).catch(() => {});
    return { thread: existing, created: false };
  }
  let name = hint?.participantName ?? null;
  let handle = hint?.participantHandle ?? null;
  let avatar: string | null = null;
  if (lookup && !isPracticeAccount(acct) && isDmPlatform(acct.platform)) {
    const ctx = await liveAccount(acct).catch(() => null);
    const p = ctx ? await fetchProfile(acct.platform, ctx, personId) : null;
    name = name ?? p?.name ?? null;
    handle = handle ?? p?.handle ?? null;
    avatar = p?.avatar ?? null;
  }
  try {
    const thread = await db.dmThread.create({
      data: {
        userId: acct.userId,
        accountId: acct.id,
        platform: acct.platform,
        participantId: personId,
        participantName: name,
        participantHandle: handle,
        participantAvatar: avatar,
        platformThreadId: hint?.conversationId ?? null,
        lastMessageAt: firstAt,
        practice: isPracticeAccount(acct),
      },
    });
    return { thread, created: true };
  } catch (err) {
    // Two webhooks for a new person at the same moment: the other one created it.
    if (!isClash(err)) throw err;
    const thread = await db.dmThread.findUnique({ where: { accountId_participantId: { accountId: acct.id, participantId: personId } } });
    if (!thread) throw err;
    return { thread, created: false };
  }
}

/** Store webhook events. Unknown accounts are skipped (Meta also sends us events for apps' test users). */
/**
 * Store webhook events. `profileLookups` caps the outbound Meta calls for new people, so a burst cannot
 * hold the webhook past Meta's timeout; threads made without one get their name on the next sync.
 */
export async function ingestEvents(events: DmEvent[], opts: { profileLookups?: number } = {}) {
  let stored = 0;
  let lookups = opts.profileLookups ?? Infinity;
  for (const ev of events) {
    // The same Instagram account or Page may be connected by more than one Outlly workspace.
    const accts = await db.socialAccount.findMany({ where: { platform: ev.platform, platformUserId: ev.accountPlatformId, status: "connected" } });
    for (const acct of accts) {
      if (ev.deleted) {
        await db.dmMessage.deleteMany({ where: { platformMessageId: ev.mid, thread: { accountId: acct.id } } });
        continue;
      }
      const { thread, created } = await threadFor(acct, ev.personId, undefined, ev.sentAt, lookups > 0);
      if (created) lookups--;
      const m: StoreMsg = { mid: ev.mid, direction: ev.direction, text: ev.text, attachments: ev.attachments, sentAt: ev.sentAt };
      if (await storeMessage(thread.id, m)) {
        await touchThread(thread, m, true);
        stored++;
        // 1118: a new message from someone (not our own reply, not a late or practice one) is worth a heads-up.
        if (m.direction === "in" && !thread.practice && Date.now() - m.sentAt.getTime() < 3600_000)
          await noticeNewMessage(acct.userId, thread.id, ev.platform, thread.participantHandle || thread.participantName || "Someone", m.text, new Date(), thread.participantAvatar);
      }
    }
  }
  return { stored };
}

/** Refresh: backfill the recent conversations of one account through the conversations API. */
export async function syncAccount(acct: SocialAccount) {
  if (!isDmPlatform(acct.platform) || isPracticeAccount(acct) || acct.status !== "connected") return { threads: 0, stored: 0 };
  const ctx = await liveAccount(acct);
  const remote = await listConversations(acct.platform, ctx);
  let stored = 0;
  let unknown = 0;
  for (const rt of remote) {
    if (!rt.messages.length) continue;
    const { thread, created } = await threadFor(acct, rt.participantId, rt, rt.updatedAt);
    // Oldest first, so the thread's preview ends on the newest one.
    const msgs = [...rt.messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    let t = thread;
    for (const rm of msgs) {
      // 1090: decide by the other person's id (the one we reply to), not by our own id, which Instagram may spell differently.
      // No sender at all: we cannot tell whose it is, and guessing "in" would re-open the 24-hour window. Skip it.
      if (!rm.fromId) {
        unknown++;
        continue;
      }
      const direction = rm.fromId === rt.participantId ? "in" : "out";
      const m: StoreMsg = { mid: rm.mid, direction, text: rm.text, attachments: rm.attachments, sentAt: rm.sentAt };
      if (!(await storeMessage(t.id, m))) continue;
      stored++;
      // A brand-new thread found by backfill is history, not news: only its newest message counts as unread.
      const countUnread = !created || rm === msgs[msgs.length - 1];
      await touchThread(t, m, countUnread);
      t = (await db.dmThread.findUnique({ where: { id: t.id } })) ?? t;
    }
  }
  if (unknown) console.warn("[messages] skipped backfilled messages without a sender", { accountId: acct.id, count: unknown });
  return { threads: remote.length, stored };
}

/* ------------------------------------------------------------------ practice */

const PRACTICE: Record<DmPlatform, { name: string; handle: string | null; msgs: [number, "in" | "out", string][] }[]> = {
  instagram: [
    { name: "Priya Sharma", handle: "@priya.makes", msgs: [[-50, "in", "Loved your last reel! What mic do you use?"]] },
    { name: "Arjun Rao", handle: "@arjun.eats", msgs: [[-26 * 60, "in", "Hey, are you open to a collab next month?"], [-25 * 60, "out", "Hi Arjun! Maybe, what did you have in mind?"]] },
  ],
  facebook: [{ name: "Meera Iyer", handle: null, msgs: [[-90, "in", "Hi! Do you ship to Pune?"]] }],
};

/** 1091: the inbox polls every 30 s; the seed check only needs to run once per user per instance now and then. */
const seededAt = new Map<string, number>();
const SEED_RECHECK_MS = 10 * 60_000;

/** Practice accounts get sample conversations so the Messages tab can be tried without Meta. */
async function seedPractice(userId: string, now = Date.now()) {
  const at = seededAt.get(userId);
  if (at && now - at < SEED_RECHECK_MS) return;
  const accts = await db.socialAccount.findMany({ where: { userId, status: "connected", platform: { in: ["instagram", "facebook"] }, platformUserId: { startsWith: "mock-" } } });
  for (const acct of accts) {
    if (!isDmPlatform(acct.platform)) continue;
    if (await db.dmThread.count({ where: { accountId: acct.id } })) continue;
    for (const [i, p] of PRACTICE[acct.platform].entries()) {
      const at = (min: number) => new Date(Date.now() + min * 60_000);
      const last = p.msgs[p.msgs.length - 1];
      const lastIn = [...p.msgs].reverse().find((m) => m[1] === "in");
      const t = await db.dmThread
        .create({
          data: {
            userId,
            accountId: acct.id,
            platform: acct.platform,
            participantId: `mock-person-${i + 1}`,
            participantName: p.name,
            participantHandle: p.handle,
            lastMessageAt: at(last[0]),
            lastInboundAt: lastIn ? at(lastIn[0]) : null,
            snippet: encrypt(preview(last[2], [], last[1])),
            unread: last[1] === "in" ? 1 : 0,
            practice: true,
          },
        })
        .catch((err) => (isClash(err) ? null : Promise.reject(err)));
      if (!t) continue;
      for (const [j, m] of p.msgs.entries()) await storeMessage(t.id, { mid: `mock-${t.id}-${j}`, direction: m[1], text: m[2], attachments: [], sentAt: at(m[0]) });
    }
  }
  // Everything checked and in place: skip the per-account counts on the next polls.
  if (accts.length) {
    if (seededAt.size > 5000) seededAt.clear();
    seededAt.set(userId, now);
  }
}

/* ------------------------------------------------------------------ read */

export interface ThreadView {
  id: string;
  platform: DmPlatform;
  accountId: string;
  accountName: string;
  participantName: string;
  participantHandle: string | null;
  participantAvatar: string | null;
  snippet: string;
  lastMessageAt: string;
  unread: number;
  /** Phase 2 (1155): hidden in Outlly (not on Instagram or Facebook) since this time. */
  archivedAt: string | null;
  practice: boolean;
  canReply: boolean;
  windowEndsAt: string | null;
  /** 1090: why the composer is locked, in words the creator can act on. Null = they can send. */
  replyBlock: ReplyBlock | null;
}

export type ReplyBlockCode = "NOT_CONNECTED" | "DMS_OFF" | "WINDOW_CLOSED";
export interface ReplyBlock {
  code: ReplyBlockCode;
  message: string;
}

/** The same checks replyToThread makes before calling Meta, so the composer never offers a send that is sure to fail. */
export function replyBlockFor(t: Pick<DmThread, "platform" | "practice" | "lastInboundAt"> & { account: Pick<SocialAccount, "status"> }, now = Date.now()): ReplyBlock | null {
  if (!isDmPlatform(t.platform)) return null;
  const name = PLATFORM_META[t.platform].name;
  if (t.account.status !== "connected") return { code: "NOT_CONNECTED", message: `Reconnect ${name} in Accounts to answer from Outlly.` };
  if (!t.practice && !dmsOn(t.platform)) return { code: "DMS_OFF", message: `Replies to ${name} messages are switched off until Meta approves messaging. You can answer in the ${name} app for now.` };
  if (!windowState(t, now).canReply) return { code: "WINDOW_CLOSED", message: closedCopy(t.platform) };
  return null;
}

type ThreadRow = DmThread & { account: Pick<SocialAccount, "username" | "displayName" | "status"> };

function toView(t: ThreadRow, now = Date.now()): ThreadView {
  return {
    id: t.id,
    platform: t.platform as DmPlatform,
    accountId: t.accountId,
    accountName: t.account.displayName || t.account.username,
    participantName: t.participantName || t.participantHandle || (t.platform === "instagram" ? "Instagram user" : "Facebook user"),
    participantHandle: t.participantHandle,
    participantAvatar: t.participantAvatar,
    snippet: safeDecrypt(t.snippet),
    lastMessageAt: t.lastMessageAt.toISOString(),
    unread: t.unread,
    archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null,
    practice: t.practice,
    ...windowState(t, now),
    replyBlock: replyBlockFor(t, now),
  };
}

/**
 * Phase 2 (1155): which threads a list shows. "inbox" = everything not archived, "unread" = not archived and
 * unread, "archived" = only the ones hidden in Outlly.
 */
export type ThreadListView = "inbox" | "unread" | "archived";
export const isThreadListView = (v: string | null | undefined): v is ThreadListView => v === "inbox" || v === "unread" || v === "archived";
export interface ListOptions {
  view?: ThreadListView;
  cursor?: string | null;
  take?: number;
}

/** scope (1037): a member limited to some accounts only sees conversations on theirs. */
export async function listThreads(userId: string, platform?: DmPlatform, scope: Scope = null, opts: ListOptions = {}) {
  await seedPractice(userId).catch((e) => console.warn("[dm] practice seed", e));
  const view = opts.view ?? "inbox";
  const take = clampTake(opts.take, THREAD_PAGE, THREAD_PAGE_MAX);
  const after = decodeCursor(opts.cursor);
  const base = { userId, account: { status: "connected" }, ...(platform ? { platform } : {}), ...(scope ? { accountId: { in: scope } } : {}) };
  const where = {
    ...base,
    ...(view === "archived" ? { archivedAt: { not: null } } : { archivedAt: null }),
    ...(view === "unread" ? { unread: { gt: 0 } } : {}),
    ...(after ? olderThan("lastMessageAt", after) : {}),
  };
  const [rows, accts, archived] = await Promise.all([
    db.dmThread.findMany({
      where,
      include: { account: { select: { username: true, displayName: true, status: true } } },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: take + 1,
    }),
    db.socialAccount.findMany({ where: { userId, status: "connected", platform: { in: DM_PLATFORMS }, ...(scope ? { id: { in: scope } } : {}) }, select: { platform: true } }),
    db.dmThread.count({ where: { ...base, archivedAt: { not: null } } }),
  ]);
  const page = rows.slice(0, take);
  const last = page[page.length - 1];
  // Filter chips only for platforms that are connected and can hold conversations.
  const platforms = DM_PLATFORMS.filter((p) => accts.some((a) => a.platform === p));
  const accounts = platform ? accts.filter((a) => a.platform === platform).length : accts.length;
  return { threads: page.map((t) => toView(t)), accounts, platforms, archived, nextCursor: rows.length > take && last ? encodeCursor(last.lastMessageAt, last.id) : null };
}

/**
 * Phase 2 (1155): mark read or unread, archive or restore. Outlly-side only: Meta's APIs have no read or archive
 * call for these conversations, so nothing changes on Instagram or Facebook and nothing is sent to the person.
 */
export async function setThreadState(userId: string, id: string, patch: { read?: boolean; archived?: boolean }, scope: Scope = null) {
  const t = await db.dmThread.findFirst({ where: { id, userId }, select: { id: true, accountId: true, unread: true } });
  if (!t || !inScope(scope, t.accountId)) throw new HttpError(404, "We couldn't find that conversation.");
  const data: Record<string, unknown> = {};
  if (patch.read === true) data.unread = 0;
  if (patch.read === false && t.unread === 0) data.unread = 1;
  if (patch.archived === true) data.archivedAt = new Date();
  if (patch.archived === false) data.archivedAt = null;
  const row = await db.dmThread.update({ where: { id: t.id }, data, include: { account: { select: { username: true, displayName: true, status: true } } } });
  return { thread: toView(row) };
}

/** Platforms whose DMs the admin switched off (1031f). Needs the keys snapshot loaded (route() and liveNow() do). */
export function dmsOffList(): DmPlatform[] {
  return (["instagram", "facebook"] as const).filter((p) => !dmsOn(p));
}

export interface MessageView {
  id: string;
  direction: "in" | "out";
  text: string;
  attachments: Att[];
  sentAt: string;
}

/**
 * One conversation, newest MESSAGE_PAGE messages, oldest first. Opening it marks it read.
 * `before` (Phase 2, 1155) pages back through the history and leaves the read state alone.
 */
export async function getThread(userId: string, id: string, scope: Scope = null, opts: { before?: string | null } = {}) {
  const t = await db.dmThread.findFirst({ where: { id, userId }, include: { account: { select: { username: true, displayName: true, status: true } } } });
  if (!t || !inScope(scope, t.accountId)) throw new HttpError(404, "We couldn't find that conversation.");
  const before = decodeCursor(opts.before);
  if (opts.before && !before) throw new HttpError(400, "That page of the conversation couldn't be read. Refresh and try again.", "VALIDATION");
  const rows = await db.dmMessage.findMany({
    where: { threadId: t.id, ...(before ? olderThan("sentAt", before) : {}) },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    take: MESSAGE_PAGE + 1,
  });
  const page = rows.slice(0, MESSAGE_PAGE);
  const oldest = page[page.length - 1];
  const olderCursor = rows.length > MESSAGE_PAGE && oldest ? encodeCursor(oldest.sentAt, oldest.id) : null;
  if (!before && t.unread) await db.dmThread.update({ where: { id: t.id }, data: { unread: 0 } });
  const messages: MessageView[] = page.reverse().map((m) => {
    let attachments: Att[] = [];
    try {
      attachments = m.attachments ? (JSON.parse(m.attachments) as Att[]) : [];
    } catch {}
    return { id: m.id, direction: m.direction === "out" ? "out" : "in", text: safeDecrypt(m.text), attachments, sentAt: m.sentAt.toISOString() };
  });
  return { thread: before ? toView(t) : { ...toView(t), unread: 0 }, messages, olderCursor };
}

/* ------------------------------------------------------------------ write */

function closedCopy(p: DmPlatform) {
  const app = p === "instagram" ? "the Instagram app" : "Messenger or Meta Business Suite";
  return `This conversation is past ${PLATFORM_META[p].name}'s 24-hour reply window. Meta only lets apps answer within 24 hours of the person's last message. You can still reply in ${app}.`;
}

/**
 * 1090: one send per (workspace, thread, clientId). A double click, a retry after a dropped
 * connection or two tabs all share the first attempt's result instead of messaging the person twice.
 * A failed attempt is forgotten at once so Retry really retries. Per server instance: on several
 * instances a duplicate can still slip through (documented; a shared store would close it).
 */
const SEND_DEDUPE_MS = 10 * 60_000;
const sends = new Map<string, { at: number; p: Promise<unknown> }>();
export function sendOnce<T>(key: string, fn: () => Promise<T>, now = Date.now()): { p: Promise<T>; duplicate: boolean } {
  for (const [k, v] of sends) if (now - v.at > SEND_DEDUPE_MS) sends.delete(k);
  const hit = sends.get(key);
  if (hit) return { p: hit.p as Promise<T>, duplicate: true };
  const p = fn();
  sends.set(key, { at: now, p });
  p.catch(() => sends.delete(key));
  return { p, duplicate: false };
}

/** Send a reply. The caller holds the weekly reply slot (see app/api/messages/[id]/route.ts). */
export async function replyToThread(userId: string, actorId: string, threadId: string, rawText: string, scope: Scope = null) {
  const text = rawText.trim();
  if (!text) throw new HttpError(400, "Write something first.", "VALIDATION");
  if (text.length > DM_MAX_CHARS) throw new HttpError(400, `Keep it under ${DM_MAX_CHARS} characters.`, "VALIDATION");
  const t = await db.dmThread.findFirst({ where: { id: threadId, userId }, include: { account: true } });
  if (!t || !isDmPlatform(t.platform) || !inScope(scope, t.accountId)) throw new HttpError(404, "We couldn't find that conversation.");
  const platform = t.platform;
  if (t.account.status !== "connected") throw new HttpError(409, `Reconnect ${PLATFORM_META[platform].name} first.`, "NOT_CONNECTED");
  if (!windowState(t).canReply) throw new HttpError(409, closedCopy(platform), "WINDOW_CLOSED");

  const practice = isPracticeAccount(t.account) || t.practice;
  if (!practice && !dmsOn(platform))
    throw new HttpError(409, `Direct messages for ${PLATFORM_META[platform].name} are switched off until Meta approves messaging.`, "DMS_OFF");
  let mid: string;
  if (practice) {
    mid = `mock-sent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  } else {
    let ctx: AccountContext;
    try {
      ctx = await liveAccount(t.account);
      mid = (await sendText(platform, ctx, t.participantId, text)).mid;
    } catch (e) {
      if (e instanceof WindowClosedError) {
        // Meta's clock says the window is over: record that so the composer closes until they write again.
        await db.dmThread.update({ where: { id: t.id }, data: { lastInboundAt: new Date(Date.now() - REPLY_WINDOW_MS - 1000) } }).catch(() => {});
        throw new HttpError(409, closedCopy(platform), "WINDOW_CLOSED", { detail: e.technical });
      }
      const pe = asPublisherError(e);
      const f = dmFailure(platform, pe, "send");
      throw new HttpError(f.status, f.message, f.code, { detail: pe.technical, ...(f.code === "RATE_LIMITED" ? { retryAfterSec: f.retryAfterSec, retryAt: f.retryAt } : {}) });
    }
  }
  const sentAt = new Date();
  const m: StoreMsg = { mid, direction: "out", text, attachments: [], sentAt, sentById: actorId };
  const fresh = await storeMessage(t.id, m);
  // The echo webhook can beat us here; then the row exists, so just credit the teammate who sent it.
  if (!fresh) await db.dmMessage.updateMany({ where: { threadId: t.id, platformMessageId: mid }, data: { sentById: actorId } });
  await touchThread(t, m, false);
  const row = await db.dmMessage.findFirst({ where: { threadId: t.id, platformMessageId: mid } });
  const message: MessageView = { id: row?.id ?? mid, direction: "out", text, attachments: [], sentAt: (row?.sentAt ?? sentAt).toISOString() };
  return { message, practice };
}

/** Refresh every connected Instagram / Facebook account of the workspace. Problems are reported, never thrown. */
export async function syncAll(userId: string, platform?: DmPlatform, scope: Scope = null) {
  const accts = await db.socialAccount.findMany({ where: { userId, status: "connected", platform: { in: platform ? [platform] : ["instagram", "facebook"] }, ...(scope ? { id: { in: scope } } : {}) } });
  const problems: { platform: DmPlatform; code: string; message: string; detail?: string; retryAt?: string | null }[] = [];
  for (const a of accts) {
    // DMs switched off (1031f): the token has no messaging permission, so asking Meta would only fail.
    if (!isDmPlatform(a.platform) || isPracticeAccount(a) || !dmsOn(a.platform)) continue;
    try {
      await syncAccount(a);
    } catch (e) {
      const pe = asPublisherError(e);
      const f = dmFailure(a.platform, pe, "sync");
      // The platform's raw error body stays in the server log; the browser gets the code only.
      console.warn("[messages] sync failed", { accountId: a.id, platform: a.platform, code: pe.code, detail: pe.technical ?? pe.message });
      problems.push({ platform: a.platform, code: pe.code, message: f.message, detail: `Error code: ${pe.code}`, ...(f.retryAt ? { retryAt: f.retryAt } : {}) });
    }
  }
  return problems;
}
