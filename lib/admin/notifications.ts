import "server-only";
import { db } from "../db";
import { CENTRE_TABS, type CentreTab } from "../notify-core";

/**
 * 1141: what the admin's Notifications screen reads. Every number here is a count of rows that exist:
 * deliveries that were attempted, skips with the reason recorded, events waiting, events that failed four
 * times. Nothing is estimated, and a window with no activity reports zeros rather than hiding the section.
 */
export const WINDOW_DAYS = 7;
const since = (days: number) => new Date(Date.now() - days * 864e5);

export type ChannelStat = { channel: string; sent: number; skipped: number; failed: number; queued: number; total: number };

export async function deliverySummary(days = WINDOW_DAYS): Promise<ChannelStat[]> {
  const rows = await db.notifyDelivery.groupBy({ by: ["channel", "status"], where: { createdAt: { gte: since(days) } }, _count: { _all: true } });
  const by = new Map<string, ChannelStat>();
  for (const r of rows) {
    const s = by.get(r.channel) ?? { channel: r.channel, sent: 0, skipped: 0, failed: 0, queued: 0, total: 0 };
    if (r.status === "sent" || r.status === "skipped" || r.status === "failed" || r.status === "queued") s[r.status] += r._count._all;
    s.total += r._count._all;
    by.set(r.channel, s);
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
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

export async function notifyOverview() {
  const [channels, reasons, categories, queue, subs] = await Promise.all([deliverySummary(), skipReasons(), categoryCounts(), queueState(), subscriptionCounts()]);
  return { channels, reasons, categories, queue, subs, days: WINDOW_DAYS };
}
