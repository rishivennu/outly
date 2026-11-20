import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { CENTRE_TABS, type CentreTab } from "../notify-core";
import { countNotifications, type NotificationCounts } from "./notifications-core";

/**
 * 1141: what the admin's Notifications screen reads. Every number here is a count of rows that exist:
 * deliveries that were attempted, skips with the reason recorded, events waiting, events that failed four
 * times. Nothing is estimated, and a window with no activity reports zeros rather than hiding the section.
 */
export const WINDOW_DAYS = 7;
const since = (days: number) => new Date(Date.now() - days * 864e5);

export type ChannelStat = { channel: string; sent: number; skipped: number; failed: number; queued: number; total: number; lastSentAt: Date | null };

export async function deliverySummary(days = WINDOW_DAYS): Promise<ChannelStat[]> {
  const rows = await db.notifyDelivery.groupBy({ by: ["channel", "status"], where: { createdAt: { gte: since(days) } }, _count: { _all: true } });
  const by = new Map<string, ChannelStat>();
  for (const r of rows) {
    const s = by.get(r.channel) ?? { channel: r.channel, sent: 0, skipped: 0, failed: 0, queued: 0, total: 0, lastSentAt: null };
    if (r.status === "sent" || r.status === "skipped" || r.status === "failed" || r.status === "queued") s[r.status] += r._count._all;
    s.total += r._count._all;
    by.set(r.channel, s);
  }
  // 1164: when each channel last accepted something, in the window or before it.
  const last = await db.notifyDelivery.groupBy({ by: ["channel"], where: { status: "sent" }, _max: { createdAt: true } });
  for (const l of last) {
    const s = by.get(l.channel);
    if (s) s.lastSentAt = l._max.createdAt ?? null;
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

/**
 * 1164: the same window counted in notifications (one decision for one creator), not channel attempts.
 * The screen used to show 170 accepted attempts, 124 held-back attempts and "Growth: 286" (every attempt in
 * that group, whatever happened to it) side by side as if they were the same unit. They never were.
 */
export async function notificationCounts(days = WINDOW_DAYS): Promise<NotificationCounts & { titles: Record<string, string> }> {
  const rows = await db.notifyDelivery.findMany({
    where: { createdAt: { gte: since(days) } },
    select: { userId: true, kind: true, category: true, channel: true, status: true, eventId: true, noticeId: true, createdAt: true },
  });
  const counts = countNotifications(rows);
  const titles = Object.fromEntries(counts.byCategory.map((c) => [c.id, CENTRE_TABS.find((t) => t.id === c.id)?.title ?? (c.id || "Other")]));
  return { ...counts, titles };
}

/** Why pushes were held back, in the admin's own words: the reasons the engine recorded, most common first. */
export async function skipReasons(days = WINDOW_DAYS) {
  const rows = await db.notifyDelivery.groupBy({ by: ["reason"], where: { status: "skipped", createdAt: { gte: since(days) } }, _count: { _all: true } });
  return rows.map((r) => ({ reason: r.reason ?? "unknown", count: r._count._all })).sort((a, b) => b.count - a.count);
}

export async function categoryCounts(days = WINDOW_DAYS) {
  const rows = await db.notifyDelivery.groupBy({ by: ["category"], where: { createdAt: { gte: since(days) } }, _count: { _all: true } });
  const title = (id: string) => CENTRE_TABS.find((t) => t.id === id)?.title ?? id;
  return rows.map((r) => ({ id: r.category as CentreTab, title: title(r.category), count: r._count._all })).sort((a, b) => b.count - a.count);
}

export async function queueState() {
  const rows = await db.notifyEvent.groupBy({ by: ["status"], _count: { _all: true } });
  const at = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  const [oldest, retrying] = await Promise.all([
    db.notifyEvent.findFirst({ where: { status: "pending" }, orderBy: { nextAt: "asc" }, select: { kind: true, nextAt: true, attempts: true } }),
    db.notifyEvent.count({ where: { status: "pending", attempts: { gt: 0 } } }),
  ]);
  return { pending: at("pending"), done: at("done"), failed: at("failed"), dead: at("dead"), retrying, oldest };
}

export async function failedDeliveries(limit = 25) {
  return db.notifyDelivery.findMany({
    where: { status: "failed" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, kind: true, channel: true, reason: true, detail: true, createdAt: true, user: { select: { name: true, email: true } } },
  });
}

export async function deadLetters(limit = 25) {
  return db.notifyDeadLetter.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, kind: true, source: true, idemKey: true, error: true, attempts: true, createdAt: true } });
}

export async function pendingQueue(limit = 25) {
  return db.notifyEvent.findMany({
    where: { status: "pending" },
    orderBy: [{ priority: "asc" }, { nextAt: "asc" }],
    take: limit,
    select: { id: true, kind: true, source: true, priority: true, attempts: true, nextAt: true, lastError: true },
  });
}

/** Who can be reached at all: phones and computers that accepted notifications. */
export async function subscriptionCounts() {
  const [web, fcm, people, quiet] = await Promise.all([
    db.webPushSub.count(),
    db.pushDevice.count(),
    db.webPushSub.groupBy({ by: ["userId"], _count: { _all: true } }).then((r) => r.length),
    db.webPushSub.count({ where: { failures: { gt: 0 } } }),
  ]);
  return { web, fcm, people, unhealthy: quiet };
}

/** The log: what was actually said, newest first, so support can read back one creator's day. */
export async function recentDeliveries(limit = 50) {
  return db.notifyDelivery.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, kind: true, category: true, channel: true, status: true, reason: true, createdAt: true, user: { select: { name: true, email: true } } },
  });
}

/**
 * 1164: who last touched the brake or sent a test, from the admin audit log. Nothing here is a schema
 * change: the PATCH and POST routes already write these two kinds of AdminEvent, and the R1267 retry route a third.
 */
export type NotifyAuditEntry = { id: string; kind: "notify_pause" | "notify_test" | "notify_retry"; title: string; body: string | null; at: string };

export async function notifyAudit(limit = 8): Promise<NotifyAuditEntry[]> {
  const rows = await db.adminEvent.findMany({ where: { kind: { in: ["notify_pause", "notify_test", "notify_retry"] } }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, kind: true, title: true, body: true, createdAt: true } });
  return rows.map((r) => ({ id: r.id, kind: r.kind as NotifyAuditEntry["kind"], title: r.title, body: r.body, at: r.createdAt.toISOString() }));
}

export async function notifyOverview() {
  const [channels, reasons, categories, queue, subs, counts] = await Promise.all([deliverySummary(), skipReasons(), categoryCounts(), queueState(), subscriptionCounts(), notificationCounts()]);
  return { channels, reasons, categories, queue, subs, counts, days: WINDOW_DAYS };
}

/**
 * R1267: search and filters for the Queue and Dead letters cards, all read from the URL so a filtered view can be
 * shared as a link. There is no channel on an event: the bell and push are decided per creator at send time, and
 * email is the one channel an event asks for itself (payload.email = true). So the channel filter is "asks for
 * email" or "bell and push only", the only split the stored rows can answer honestly.
 */
export const QUEUE_STATUSES = ["waiting", "retrying", "dead", "failed"] as const;
export const QUEUE_CHANNELS = ["email", "inapp"] as const;
export const QUEUE_LIMITS = [25, 50, 100] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];
export type QueueChannel = (typeof QUEUE_CHANNELS)[number];
export type QueueFilters = { q: string; status: QueueStatus | ""; channel: QueueChannel | ""; from: string; to: string; limit: (typeof QUEUE_LIMITS)[number] };
type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : "");
const pick = <T extends string>(list: readonly T[], v: string): T | "" => (list.includes(v as T) ? (v as T) : "");

export function parseQueueFilters(sp: Params): QueueFilters {
  const limit = Number(one(sp.limit));
  let from = day(one(sp.from));
  let to = day(one(sp.to));
  if (from && to && from > to) [from, to] = [to, from];
  return {
    q: one(sp.q).trim().slice(0, 100),
    status: pick(QUEUE_STATUSES, one(sp.status)),
    channel: pick(QUEUE_CHANNELS, one(sp.channel)),
    from,
    to,
    limit: (QUEUE_LIMITS as readonly number[]).includes(limit) ? (limit as QueueFilters["limit"]) : 25,
  };
}

export const filtersOn = (f: QueueFilters) => !!(f.q || f.status || f.channel || f.from || f.to);

/** Inclusive UTC days, the same convention as the analytics date range. */
function createdIn(f: QueueFilters): { gte?: Date; lt?: Date } | undefined {
  if (!f.from && !f.to) return undefined;
  return { ...(f.from ? { gte: new Date(`${f.from}T00:00:00.000Z`) } : {}), ...(f.to ? { lt: new Date(Date.parse(`${f.to}T00:00:00.000Z`) + 864e5) } : {}) };
}

/**
 * `contains` without `mode` so SQLite keeps working: its LIKE ignores ASCII case. The lower-case copy covers a
 * typed capital on providers that compare case-sensitively (kinds and ids are lower case already).
 */
function textMatch(q: string) {
  const terms = [...new Set([q, q.toLowerCase()])];
  return terms.flatMap((t) => [{ kind: { contains: t } }, { userId: { contains: t } }, { payload: { contains: t } }]);
}

const EMAIL_ASKED = '"email":true';
const channelMatch = (c: QueueChannel | "") => (c === "email" ? { payload: { contains: EMAIL_ASKED } } : c === "inapp" ? { NOT: { payload: { contains: EMAIL_ASKED } } } : null);

/** null: the status filter rules this list out entirely (a dead letter is never "waiting"). */
export function queueWhere(f: QueueFilters): Prisma.NotifyEventWhereInput | null {
  if (f.status === "dead") return null;
  const status: Prisma.NotifyEventWhereInput =
    f.status === "failed" ? { status: "failed" } : f.status === "retrying" ? { status: "pending", attempts: { gt: 0 } } : f.status === "waiting" ? { status: "pending", attempts: 0 } : { status: "pending" };
  const and: Prisma.NotifyEventWhereInput[] = [];
  if (f.q) and.push({ OR: textMatch(f.q) });
  const ch = channelMatch(f.channel);
  if (ch) and.push(ch);
  const created = createdIn(f);
  return { ...status, ...(created ? { createdAt: created } : {}), ...(and.length ? { AND: and } : {}) };
}

export function deadLetterWhere(f: QueueFilters): Prisma.NotifyDeadLetterWhereInput | null {
  if (f.status && f.status !== "dead") return null;
  const and: Prisma.NotifyDeadLetterWhereInput[] = [];
  if (f.q) and.push({ OR: textMatch(f.q) });
  const ch = channelMatch(f.channel);
  if (ch) and.push(ch);
  const created = createdIn(f);
  return { ...(created ? { createdAt: created } : {}), ...(and.length ? { AND: and } : {}) };
}

const titleOf = (payload: string) => {
  try {
    const t = (JSON.parse(payload) as { title?: unknown }).title;
    return typeof t === "string" ? t.slice(0, 140) : null;
  } catch {
    return null;
  }
};
const asksEmail = (payload: string) => payload.includes(EMAIL_ASKED);

export type QueueRow = { id: string; kind: string; title: string | null; source: string; priority: number; attempts: number; nextAt: Date; lastError: string | null; email: boolean; userId: string; userEmail: string | null; createdAt: Date };
export type DeadRow = { id: string; kind: string; title: string | null; source: string; attempts: number; error: string; email: boolean; userId: string | null; userEmail: string | null; createdAt: Date };

/** null when the status filter excludes the queue, so the page can say "nothing matches" rather than "empty". */
export async function searchQueue(f: QueueFilters): Promise<QueueRow[] | null> {
  const where = queueWhere(f);
  if (!where) return null;
  const rows = await db.notifyEvent.findMany({
    where,
    orderBy: [{ priority: "asc" }, { nextAt: "asc" }],
    take: f.limit,
    select: { id: true, kind: true, source: true, priority: true, attempts: true, nextAt: true, lastError: true, payload: true, userId: true, createdAt: true, user: { select: { email: true } } },
  });
  return rows.map(({ payload, user, ...r }) => ({ ...r, title: titleOf(payload), email: asksEmail(payload), userEmail: user?.email ?? null }));
}

export async function searchDeadLetters(f: QueueFilters): Promise<DeadRow[] | null> {
  const where = deadLetterWhere(f);
  if (!where) return null;
  const rows = await db.notifyDeadLetter.findMany({ where, orderBy: { createdAt: "desc" }, take: f.limit, select: { id: true, kind: true, source: true, error: true, attempts: true, payload: true, userId: true, createdAt: true } });
  // A dead letter has no relation to the creator, so their addresses come in one batched read, never one per row.
  const ids = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : [];
  const email = new Map(users.map((u) => [u.id, u.email]));
  return rows.map(({ payload, ...r }) => ({ ...r, title: titleOf(payload), email: asksEmail(payload), userEmail: r.userId ? (email.get(r.userId) ?? null) : null }));
}
