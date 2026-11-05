import "server-only";
import { db } from "../db";
import { isPlatform, type Platform } from "../domain";
import { isPracticeAccount } from "../social/registry";
import { snapshotTarget, targetInsights } from "../insights/post";
import { platformDashboard } from "../live";
import { dayKey } from "./core";

/**
 * 1140: the background metric sync. Before this, a post's numbers were only ever stored when somebody
 * opened its insights popup, so the analytics history had holes and follower growth could not be charted
 * at all. The minute sweeper now calls this with a small budget, so history fills itself in.
 *
 * It is deliberately modest:
 *  - only accounts on platforms with a real per-post reader (Instagram, YouTube, Facebook);
 *  - only posts published recently, whose stored numbers are already stale;
 *  - a hard budget and per-run caps, so one sweep never spends a minute on analytics;
 *  - a platform that asks us to slow down puts that account in cooldown instead of being retried;
 *  - one account-level snapshot per account per UTC day, which is what follower growth is drawn from.
 * Nothing here invents a number: a metric the platform did not return is simply not written.
 */

/** Platforms whose per-post numbers Outlly can read (lib/insights/post.ts SUPPORTED). */
export const SYNCABLE: Platform[] = ["instagram", "youtube", "facebook"];
/** A target whose newest stored row is younger than this is already fresh enough. */
export const TARGET_STALE_MS = 6 * 3600_000;
/** Posts older than this stop being synced: their counts barely move and the quota is better spent. */
export const RECENT_DAYS = 45;
export const TARGETS_PER_ACCOUNT = 6;
export const TARGETS_PER_RUN = 24;
export const ACCOUNTS_PER_RUN = 10;
/** How long a rate-limited account is left alone. */
export const COOLDOWN_MS = 30 * 60_000;
const DEFAULT_BUDGET_MS = 8_000;

export interface SyncReport {
  accounts: number;
  targets: number;
  /** Targets whose numbers came back and were stored (a delta of nothing still counts as confirmed). */
  synced: number;
  snapshots: number;
  cooled: number;
  failed: number;
  ranMs: number;
}

type Pick_ = { id: string; userId: string; platform: string; lastTriedAt: number };

/** Accounts worth asking about, least recently tried first, skipping anything in cooldown. */
async function candidates(now: Date, accountIds?: string[]): Promise<Pick_[]> {
  const rows = await db.socialAccount.findMany({
    where: { status: "connected", platform: { in: SYNCABLE }, ...(accountIds ? { id: { in: accountIds } } : {}) },
    select: { id: true, userId: true, platform: true, platformUserId: true, username: true, syncState: { select: { lastTriedAt: true, cooldownUntil: true } } },
  });
  return rows
    .filter((a) => isPlatform(a.platform) && !isPracticeAccount(a))
    .filter((a) => !a.syncState?.cooldownUntil || a.syncState.cooldownUntil <= now)
    .map((a) => ({ id: a.id, userId: a.userId, platform: a.platform, lastTriedAt: a.syncState?.lastTriedAt?.getTime() ?? 0 }))
    .sort((a, b) => a.lastTriedAt - b.lastTriedAt)
    .slice(0, ACCOUNTS_PER_RUN);
}

/** The recently published destinations of one account whose stored numbers are stale, newest first. */
async function dueTargets(accountId: string, now: Date) {
  const since = new Date(now.getTime() - RECENT_DAYS * 864e5);
  const rows = await db.postTarget.findMany({
    where: {
      socialAccountId: accountId,
      practice: false,
      platformStatus: "published",
      platformPostId: { not: null },
      publishedAt: { gte: since },
      OR: [{ removeMode: null }, { removeMode: { not: "deleted" } }],
    },
    include: { socialAccount: true },
    orderBy: { publishedAt: "desc" },
    take: 40,
  });
  if (!rows.length) return [];
  const last = await db.targetMetric.groupBy({ by: ["targetId"], where: { targetId: { in: rows.map((r) => r.id) } }, _max: { capturedAt: true } });
  const seen = new Map(last.map((l) => [l.targetId, l._max.capturedAt?.getTime() ?? 0]));
  return rows.filter((r) => now.getTime() - (seen.get(r.id) ?? 0) >= TARGET_STALE_MS).slice(0, TARGETS_PER_ACCOUNT);
}

async function noteSync(accountId: string, data: { lastSyncAt?: Date; lastTriedAt: Date; lastError?: string | null; cooldownUntil?: Date | null; targetsDone?: number }) {
  await db.accountSyncState
    .upsert({ where: { accountId }, create: { accountId, ...data }, update: data })
    .catch((e) => console.warn(`[sync] state ${accountId}: ${(e as Error).message}`));
}

/**
 * One row per account per UTC day, from the platform's own totals (followers, posts, views in that
 * platform's own window). Written once a day: the dashboard call behind it is cached, so this costs at
 * most one round trip per account per day. A total the platform did not give stays null.
 */
async function writeDaySnapshot(a: Pick_, now: Date): Promise<boolean> {
  const day = dayKey(now);
  if (await db.accountSnapshot.findUnique({ where: { accountId_day: { accountId: a.id, day } }, select: { id: true } })) return false;
  const d = await platformDashboard(a.userId, a.platform as Platform, { accountId: a.id }).catch(() => null);
  if (!d || d.status !== "ok" || !d.totals) return false;
  const t = d.totals;
  if (t.followers === null && t.posts === null && t.views === null) return false;
  await db.accountSnapshot.create({ data: { accountId: a.id, day, followers: t.followers, posts: t.posts, views: t.views, viewsScope: t.viewsScope ?? null } }).catch(() => {});
  return true;
}

export async function syncMetrics(opts: { budgetMs?: number; now?: Date; accountIds?: string[] } = {}): Promise<SyncReport> {
  const started = Date.now();
  const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const now = opts.now ?? new Date();
  const r: SyncReport = { accounts: 0, targets: 0, synced: 0, snapshots: 0, cooled: 0, failed: 0, ranMs: 0 };
  const left = () => budget - (Date.now() - started);

  const accts = await candidates(now, opts.accountIds);
  for (const a of accts) {
    if (left() <= 500 || r.targets >= TARGETS_PER_RUN) break;
    r.accounts++;
    const targets = await dueTargets(a.id, now).catch(() => []);
    let ok = 0;
    let stop: string | null = null;
    for (const t of targets) {
      if (left() <= 500 || r.targets >= TARGETS_PER_RUN) break;
      r.targets++;
      const ins = await targetInsights(t).catch(() => null);
      if (!ins) {
        r.failed++;
        continue;
      }
      if (ins.status === "error") {
        // The whole account is affected by these two, so stop asking it anything else this run.
        if (ins.code === "RATE_LIMITED" || ins.code === "AUTH_EXPIRED") {
          stop = ins.code;
          break;
        }
        r.failed++;
        continue;
      }
      if (ins.status !== "live") continue;
      await snapshotTarget(ins).catch((e) => console.warn(`[sync] snapshot ${ins.targetId}: ${(e as Error).message}`));
      ok++;
      r.synced++;
    }
    if (stop === "RATE_LIMITED") {
      r.cooled++;
      await noteSync(a.id, { lastTriedAt: now, lastError: stop, cooldownUntil: new Date(now.getTime() + COOLDOWN_MS), targetsDone: ok });
      continue;
    }
    if (stop === "AUTH_EXPIRED") {
      r.failed++;
      await noteSync(a.id, { lastTriedAt: now, lastError: stop, cooldownUntil: new Date(now.getTime() + COOLDOWN_MS), targetsDone: ok });
      continue;
    }
    if (left() > 1_000 && (await writeDaySnapshot(a, now).catch(() => false))) r.snapshots++;
    await noteSync(a.id, { lastSyncAt: now, lastTriedAt: now, lastError: null, cooldownUntil: null, targetsDone: ok });
  }
  r.ranMs = Date.now() - started;
  return r;
}

export type SyncTimes = Record<string, { lastSyncAt: string | null; lastError: string | null; cooldownUntil: string | null }>;

/** When each account was last synced, for the cards that have to say how fresh a number is. */
export async function syncTimes(accountIds: string[]): Promise<SyncTimes> {
  if (!accountIds.length) return {};
  const rows = await db.accountSyncState.findMany({ where: { accountId: { in: accountIds } }, select: { accountId: true, lastSyncAt: true, lastError: true, cooldownUntil: true } });
  return Object.fromEntries(
    rows.map((s) => [s.accountId, { lastSyncAt: s.lastSyncAt?.toISOString() ?? null, lastError: s.lastError, cooldownUntil: s.cooldownUntil?.toISOString() ?? null }]),
  );
}

/** The daily history Outlly has for these accounts, oldest first. Only real rows: no gap filling. */
export async function accountHistory(accountIds: string[], from: string, to: string) {
  if (!accountIds.length) return [];
  return db.accountSnapshot.findMany({
    where: { accountId: { in: accountIds }, day: { gte: from.slice(0, 10), lt: to.slice(0, 10) } },
    select: { accountId: true, day: true, followers: true, posts: true, views: true, viewsScope: true },
    orderBy: { day: "asc" },
  });
}
