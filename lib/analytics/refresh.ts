import "server-only";
import { db } from "../db";
import { invalidate } from "../cache";
import { isPlatform, PLATFORM_META, type Platform } from "../domain";
import { invalidateDashboards, platformDashboard } from "../live";
import { isPracticeAccount } from "../social/registry";
import { SYNCABLE, syncMetrics, type SyncOutcome } from "./sync";

/**
 * 1151: Refresh Data. A person asked for fresh numbers, so every account in scope is asked right now: the
 * recent posts' numbers (the background sync, forced) and the account's own insights (followers, reach),
 * skipping every cache. The answer says, per account, what really came back. Nothing is reported as
 * refreshed unless the platform answered: a failure keeps the last good numbers and says how old they are.
 */
export type RefreshCode = "FRESH" | "PARTIAL" | "FAILED" | "RATE_LIMITED" | "NEEDS_RECONNECT";
export type RefreshItem = {
  accountId: string;
  platform: Platform;
  username: string;
  /** Fresh data came back for this account in this refresh. */
  ok: boolean;
  code: RefreshCode;
  message: string;
  /** The last successful sync, after this refresh (ISO), or null when there never was one. */
  lastSuccessAt: string | null;
};
export type RefreshResult = { ok: boolean; complete: boolean; at: string; items: RefreshItem[]; message: string };

const BUDGET_MS = 20_000;

const fmt = (iso: string | null, tz: string) => {
  if (!iso) return null;
  const o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-IN", { ...o, timeZone: tz }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-IN", { ...o, timeZone: "UTC" }).format(new Date(iso));
  }
};
const who = (platform: Platform, username: string) => `${PLATFORM_META[platform].name} ${username ? (username.startsWith("@") ? username : `@${username}`) : ""}`.trim();

/** One account's verdict from what the sync and the live read said. Pure, exported for tests. */
export function verdict(o: { syncable: boolean; outcome: SyncOutcome | null; cooldownUntil: Date | null; liveOk: boolean; reconnect: boolean; now: Date }): { ok: boolean; code: RefreshCode; why: string } {
  if (o.reconnect) return { ok: false, code: "NEEDS_RECONNECT", why: "needs reconnecting before it can share fresh numbers" };
  const cooled = (o.outcome?.code === "RATE_LIMITED" || (!o.outcome && o.cooldownUntil && o.cooldownUntil > o.now)) && o.syncable;
  const postsOk = !o.syncable || (o.outcome ? o.outcome.ok : false);
  if (cooled && !o.liveOk) return { ok: false, code: "RATE_LIMITED", why: "asked Outlly to slow down, so it can't be read again yet" };
  if (o.liveOk && postsOk) return { ok: true, code: "FRESH", why: "" };
  if (o.liveOk || (o.outcome?.ok && (o.outcome.synced ?? 0) > 0))
    return { ok: false, code: "PARTIAL", why: o.liveOk ? (cooled ? "asked Outlly to slow down, so its post numbers weren't read again" : "didn't return its post numbers") : "didn't return its latest account insights" };
  if (o.outcome?.code === "AUTH_EXPIRED") return { ok: false, code: "NEEDS_RECONNECT", why: "says its connection expired, so it needs reconnecting" };
  return { ok: false, code: "FAILED", why: "didn't return fresh data" };
}

export async function refreshData(o: { ownerId: string; scope: string[] | null; platform?: string | null; tz?: string; now?: Date }): Promise<RefreshResult> {
  const now = o.now ?? new Date();
  const tz = o.tz || "UTC";
  const rows = await db.socialAccount.findMany({
    where: {
      userId: o.ownerId,
      status: { not: "disconnected" },
      ...(o.scope ? { id: { in: o.scope } } : {}),
      ...(o.platform && isPlatform(o.platform) ? { platform: o.platform } : {}),
    },
    select: { id: true, platform: true, username: true, platformUserId: true, status: true, syncState: { select: { cooldownUntil: true } } },
    orderBy: { createdAt: "asc" },
  });
  const accts = rows.filter((a) => isPlatform(a.platform) && !isPracticeAccount(a));
  if (!accts.length) return { ok: false, complete: false, at: now.toISOString(), items: [], message: "There's no connected account to refresh. Connect one in Connected accounts first." };

  const live = accts.filter((a) => a.status === "connected");
  const syncIds = live.filter((a) => (SYNCABLE as string[]).includes(a.platform)).map((a) => a.id);
  invalidateDashboards(o.ownerId);
  const [report, boards] = await Promise.all([
    syncIds.length ? syncMetrics({ accountIds: syncIds, force: true, budgetMs: BUDGET_MS, now }).catch(() => null) : Promise.resolve(null),
    Promise.all(
      live.map((a) =>
        platformDashboard(o.ownerId, a.platform as Platform, { accountId: a.id, fresh: true })
          .then((d) => [a.id, d.status === "ok"] as const)
          .catch(() => [a.id, false] as const),
      ),
    ),
  ]);
  invalidate(`pip:stats:${o.ownerId}:`);
  const liveOk = new Map(boards);
  const outcomes = new Map((report?.outcomes ?? []).map((x) => [x.accountId, x]));
  const states = await db.accountSyncState.findMany({ where: { accountId: { in: accts.map((a) => a.id) } }, select: { accountId: true, lastSyncAt: true } }).catch(() => []);
  const last = new Map(states.map((s) => [s.accountId, s.lastSyncAt?.toISOString() ?? null]));

  const items: RefreshItem[] = accts.map((a) => {
    const p = a.platform as Platform;
    const v = verdict({
      syncable: (SYNCABLE as string[]).includes(p),
      outcome: outcomes.get(a.id) ?? null,
      cooldownUntil: a.syncState?.cooldownUntil ?? null,
      liveOk: liveOk.get(a.id) ?? false,
      reconnect: a.status === "needs_reconnect",
      now,
    });
    const lastSuccessAt = last.get(a.id) ?? null;
    const name = who(p, a.username);
    const since = fmt(lastSuccessAt, tz);
    const message = v.ok
      ? `${name}: refreshed just now.`
      : `${name} ${v.why}. ${since ? `Its numbers are from the last successful sync, ${since}.` : "Outlly has no successful sync for it yet."}`;
    return { accountId: a.id, platform: p, username: a.username, ok: v.ok, code: v.code, message, lastSuccessAt };
  });
  const good = items.filter((i) => i.ok);
  const bad = items.filter((i) => !i.ok);
  const message = !good.length
    ? `Nothing was refreshed. ${bad.map((i) => i.message).join(" ")}`
    : !bad.length
      ? `Refreshed just now: ${good.map((i) => who(i.platform, i.username)).join(", ")}.`
      : `Refreshed just now: ${good.map((i) => who(i.platform, i.username)).join(", ")}. ${bad.map((i) => i.message).join(" ")}`;
  return { ok: good.length > 0, complete: !bad.length, at: now.toISOString(), items, message };
}
