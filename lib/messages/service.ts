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
import { DM_MAX_CHARS, fetchProfile, isDmPlatform, listConversations, REPLY_WINDOW_MS, sendText, WindowClosedError, type DmPlatform, type RemoteThread } from "./meta";
import type { DmEvent } from "./webhook";

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
  for (const rt of remote) {
    if (!rt.messages.length) continue;
    const { thread, created } = await threadFor(acct, rt.participantId, rt, rt.updatedAt);
    // Oldest first, so the thread's preview ends on the newest one.
    const msgs = [...rt.messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    let t = thread;
    for (const rm of msgs) {
      const m: StoreMsg = { mid: rm.mid, direction: rm.fromId === acct.platformUserId ? "out" : "in", text: rm.text, attachments: rm.attachments, sentAt: rm.sentAt };
      if (!(await storeMessage(t.id, m))) continue;
      stored++;
      // A brand-new thread found by backfill is history, not news: only its newest message counts as unread.
      const countUnread = !created || rm === msgs[msgs.length - 1];
      await touchThread(t, m, countUnread);
      t = (await db.dmThread.findUnique({ where: { id: t.id } })) ?? t;
    }
  }
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

/** Practice accounts get sample conversations so the Messages tab can be tried without Meta. */
async function seedPractice(userId: string) {
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
  practice: boolean;
  canReply: boolean;
  windowEndsAt: string | null;
}

type ThreadRow = DmThread & { account: Pick<SocialAccount, "username" | "displayName" | "status"> };

function view(t: ThreadRow, now = Date.now()): ThreadView {
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
    practice: t.practice,
    ...windowState(t, now),
  };
}

/** scope (1037): a member limited to some accounts only sees conversations on theirs. */
export async function listThreads(userId: string, platform?: DmPlatform, scope: Scope = null) {
  await seedPractice(userId).catch((e) => console.warn("[dm] practice seed", e));
  const rows = await db.dmThread.findMany({
    where: { userId, account: { status: "connected" }, ...(platform ? { platform } : {}), ...(scope ? { accountId: { in: scope } } : {}) },
    include: { account: { select: { username: true, displayName: true, status: true } } },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
  });
  const connected = await db.socialAccount.count({ where: { userId, status: "connected", platform: { in: platform ? [platform] : ["instagram", "facebook"] }, ...(scope ? { id: { in: scope } } : {}) } });
  return { threads: rows.map((t) => view(t)), accounts: connected };
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

export async function getThread(userId: string, id: string, scope: Scope = null) {
  const t = await db.dmThread.findFirst({ where: { id, userId }, include: { account: { select: { username: true, displayName: true, status: true } } } });
  if (!t || !inScope(scope, t.accountId)) throw new HttpError(404, "We couldn't find that conversation.");
  const rows = await db.dmMessage.findMany({ where: { threadId: t.id }, orderBy: { sentAt: "desc" }, take: 200 });
  if (t.unread) await db.dmThread.update({ where: { id: t.id }, data: { unread: 0 } });
  const messages: MessageView[] = rows.reverse().map((m) => {
    let attachments: Att[] = [];
    try {
      attachments = m.attachments ? (JSON.parse(m.attachments) as Att[]) : [];
    } catch {}
    return { id: m.id, direction: m.direction === "out" ? "out" : "in", text: safeDecrypt(m.text), attachments, sentAt: m.sentAt.toISOString() };
  });
  return { thread: { ...view(t), unread: 0 }, messages };
}

/* ------------------------------------------------------------------ write */

function closedCopy(p: DmPlatform) {
  const app = p === "instagram" ? "the Instagram app" : "Messenger or Meta Business Suite";
  return `This conversation is past ${PLATFORM_META[p].name}'s 24-hour reply window. Meta only lets apps answer within 24 hours of the person's last message. You can still reply in ${app}.`;
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
      const name = PLATFORM_META[platform].name;
      if (pe.code === "AUTH_EXPIRED") throw new HttpError(409, `${name} needs you to reconnect.`, "NOT_CONNECTED", { detail: pe.technical });
      if (pe.code === "FORBIDDEN")
        throw new HttpError(403, `${name} didn't let Outlly send this. The app may still be waiting for Meta to approve messaging, or this person can't be messaged by apps.`, "FORBIDDEN", { detail: pe.technical });
      if (pe.code === "RATE_LIMITED") throw new HttpError(429, `${name} asked us to slow down for a minute.`, "RATE_LIMITED", { detail: pe.technical });
      if (pe.code === "MEDIA_REJECTED") throw new HttpError(422, `${name} didn't accept that message. Try shorter text without unusual characters.`, "REJECTED", { detail: pe.technical });
      throw new HttpError(502, `We couldn't reach ${name} just now. Try again in a moment.`, pe.code, { detail: pe.technical });
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
  const problems: { platform: DmPlatform; code: string; message: string; detail?: string }[] = [];
  for (const a of accts) {
    // DMs switched off (1031f): the token has no messaging permission, so asking Meta would only fail.
    if (!isDmPlatform(a.platform) || isPracticeAccount(a) || !dmsOn(a.platform)) continue;
    try {
      await syncAccount(a);
    } catch (e) {
      const pe = asPublisherError(e);
      const name = PLATFORM_META[a.platform].name;
      const message =
        pe.code === "AUTH_EXPIRED"
          ? `${name} needs you to reconnect.`
          : pe.code === "FORBIDDEN"
            ? `${name} didn't share messages yet. Reconnect ${name} so Outlly can ask for the messaging permission. While the Meta app is in Development mode, only people with a role on the app show up.`
            : `We couldn't reach ${name} just now.`;
      problems.push({ platform: a.platform, code: pe.code, message, detail: pe.technical ?? pe.message });
    }
  }
  return problems;
}
