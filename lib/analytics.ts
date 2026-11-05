import "server-only";
import { db } from "./db";
import { cached } from "./cache";
import { storage } from "./storage";
import { PLATFORMS, type Platform } from "./domain";
import { engagementPct, hasStoredReader, resolveRange, type RangeWindow, type StandoutPost } from "./analytics/core";
import { accountHistory, syncTimes, type SyncTimes } from "./analytics/sync";

export interface AnalyticsSummary {
  rangeDays: number;
  /** 1140: the exact window these numbers cover, so a custom range can be named and exported honestly. */
  window: RangeWindow;
  totals: { views: number; likes: number; comments: number; shares: number; saves: number; engagement: number };
  previous: { views: number; engagement: number };
  series: ({ date: string } & Record<Platform, number>)[];
  /** 1140: interactions per view for each day, null on days with no views (never drawn as zero). */
  engagementSeries: { date: string; value: number | null }[];
  /**
   * 1140: follower history per account, from the daily snapshots Outlly keeps. Never summed across
   * accounts or platforms: every platform counts followers its own way.
   */
  followerHistory: { accountId: string; platform: Platform; username: string; metric: "followers" | "subscribers"; points: { date: string; value: number }[] }[];
  byPlatform: { platform: Platform; views: number; engagement: number; posts: number; connected: boolean; reader: boolean }[];
  top: { postId: string; title: string; thumbnailUrl: string | null; views: number; platform: Platform } | null;
  /** 1140: the ranked list behind "Your standout content". Ordering happens on the client. */
  standouts: StandoutPost[];
  /** Mean views per published destination in this window, for the "vs your average" comparison. */
  avgViews: number;
  bestDay: string | null;
  hasData: boolean;
  /** 1037: the same numbers per connected account, for the combined view's drilldown. Biggest first. */
  byAccount: { accountId: string; platform: Platform; username: string; avatar: string | null; views: number; engagement: number; posts: number; saves: number; lastSyncAt: string | null }[];
  /** The accounts these numbers cover; null = every account. */
  accountIds: string[] | null;
}

const STANDOUT_ROWS = 24;

/** Metrics only change when the sync job writes them, so a 60 s per-creator copy makes range switches and revisits instant. */
export function getAnalytics(userId: string, rangeDays = 30, accountIds: string[] | null = null, opts: { from?: string | null; to?: string | null; maxDays?: number } = {}): Promise<AnalyticsSummary> {
  const ids = accountIds ? [...new Set(accountIds)].sort() : null;
  // 1140: a custom range is resolved here, inside the plan's history window, so every caller gets the
  // same clamping and the cache key names the real window rather than the request.
  const w = resolveRange({ days: rangeDays, from: opts.from, to: opts.to }, opts.maxDays ?? rangeDays);
  return cached(`analytics:${userId}:${w.from}:${w.to}:${ids ? ids.join(",") : "all"}`, 60_000, () => computeAnalytics(userId, w, ids));
}

async function computeAnalytics(userId: string, w: RangeWindow, accountIds: string[] | null): Promise<AnalyticsSummary> {
  const since = new Date(w.from);
  const until = new Date(w.to);
  const prevSince = new Date(since.getTime() - w.days * 864e5);
  // Numbers only (10-14 perf): the post title and thumbnail used to ride along on every metric row,
  // which multiplied the payload by the number of snapshots. Only the standouts need them, fetched below.
  const rows = await db.targetMetric.findMany({
    where: { capturedAt: { gte: prevSince, lt: until }, target: { post: { userId }, practice: false, ...(accountIds ? { socialAccountId: { in: accountIds } } : {}) } },
    select: { capturedAt: true, views: true, likes: true, comments: true, shares: true, saves: true, targetId: true, target: { select: { platform: true, postId: true, socialAccountId: true } } },
  });

  const cur = rows.filter((r) => r.capturedAt >= since);
  const prev = rows.filter((r) => r.capturedAt < since);
  type Row = (typeof rows)[number];
  const sum = (rs: Row[], k: "views" | "likes" | "comments" | "shares" | "saves") => rs.reduce((a, r) => a + r[k], 0);
  const eng = (rs: Row[]) => {
    const v = sum(rs, "views");
    return v ? ((sum(rs, "likes") + sum(rs, "comments") + sum(rs, "shares") + sum(rs, "saves")) / v) * 100 : 0;
  };

  const days = new Map<string, Record<Platform, number>>();
  const dayEng = new Map<string, { views: number; acts: number }>();
  for (let t = since.getTime(); t < until.getTime(); t += 864e5) {
    const k = new Date(t).toISOString().slice(0, 10);
    days.set(k, Object.fromEntries(PLATFORMS.map((p) => [p, 0])) as Record<Platform, number>);
    dayEng.set(k, { views: 0, acts: 0 });
  }
  for (const r of cur) {
    const k = r.capturedAt.toISOString().slice(0, 10);
    const d = days.get(k);
    if (d && (PLATFORMS as readonly string[]).includes(r.target.platform)) d[r.target.platform as Platform] += r.views;
    const e = dayEng.get(k);
    if (e) {
      e.views += r.views;
      e.acts += r.likes + r.comments + r.shares + r.saves;
    }
  }
  const series = [...days].map(([date, v]) => ({ date, ...v }));
  // A day with no views has no engagement rate: null, so the chart leaves a gap instead of drawing 0%.
  const engagementSeries = [...dayEng].map(([date, e]) => ({ date, value: e.views ? (e.acts / e.views) * 100 : null }));

  // Per destination, which is what a "post" means here: the same video on two platforms is two rows.
  const perTarget = new Map<string, { views: number; likes: number; comments: number; shares: number; saves: number; row: Row }>();
  for (const r of cur) {
    const e = perTarget.get(r.targetId) ?? { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, row: r };
    e.views += r.views;
    e.likes += r.likes;
    e.comments += r.comments;
    e.shares += r.shares;
    e.saves += r.saves;
    perTarget.set(r.targetId, e);
  }
  const ranked = [...perTarget].sort((a, b) => b[1].views - a[1].views);
  const topIds = ranked.slice(0, STANDOUT_ROWS).map(([id]) => id);

  const weekday = new Map<number, number>();
  for (const s of series) {
    const wd = new Date(s.date).getDay();
    weekday.set(wd, (weekday.get(wd) ?? 0) + PLATFORMS.reduce((a, p) => a + s[p], 0));
  }
  const bestWd = [...weekday].sort((a, b) => b[1] - a[1])[0];

  // One query for the standouts' titles, links and thumbnails (1140: a list, not just the single best).
  const targets = topIds.length
    ? await db.postTarget.findMany({
        where: { id: { in: topIds } },
        select: { id: true, postId: true, platform: true, title: true, platformUrl: true, publishedAt: true, socialAccountId: true, socialAccount: { select: { username: true } }, post: { select: { title: true, hook: true, media: { select: { thumbnailKey: true } } } } },
      })
    : [];
  const byTargetId = new Map(targets.map((t) => [t.id, t]));
  const thumbs = new Map<string, string | null>();
  await Promise.all(
    [...new Set(targets.map((t) => t.post.media?.thumbnailKey).filter((k): k is string => !!k))].map(async (k) => {
      thumbs.set(k, k.startsWith("/") ? k : await storage.signedUrl(k, 6 * 3600).catch(() => null));
    }),
  );
  const standouts: StandoutPost[] = topIds.flatMap((id) => {
    const t = byTargetId.get(id);
    const m = perTarget.get(id);
    if (!t || !m) return [];
    const tk = t.post.media?.thumbnailKey;
    return [{
      targetId: id,
      postId: t.postId,
      title: t.title || t.post.title || t.post.hook?.split("\n")[0] || "Untitled",
      thumbnailUrl: tk ? (thumbs.get(tk) ?? null) : null,
      platform: t.platform,
      accountId: t.socialAccountId,
      username: t.socialAccount?.username ?? null,
      url: t.platformUrl,
      publishedAt: t.publishedAt?.toISOString() ?? null,
      views: m.views,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      saves: m.saves,
      engagement: engagementPct(m),
    }];
  });

  const topE = ranked[0];
  const topT = topE ? byTargetId.get(topE[0]) : undefined;
  const topTk = topT?.post.media?.thumbnailKey;

  // Per account (1037). One small query for names; numbers come from the rows already loaded.
  const acctIds = [...new Set(cur.map((r) => r.target.socialAccountId).filter((x): x is string => !!x))];
  const [accts, times] = await Promise.all([
    acctIds.length ? db.socialAccount.findMany({ where: { id: { in: acctIds }, userId }, select: { id: true, platform: true, username: true, avatar: true } }) : Promise.resolve([]),
    acctIds.length ? syncTimes(acctIds).catch((): SyncTimes => ({})) : Promise.resolve({} as SyncTimes),
  ]);
  const byAccount = accts
    .filter((a) => (PLATFORMS as readonly string[]).includes(a.platform))
    .map((a) => {
      const rs = cur.filter((r) => r.target.socialAccountId === a.id);
      return {
        accountId: a.id,
        platform: a.platform as Platform,
        username: a.username,
        avatar: a.avatar,
        views: sum(rs, "views"),
        engagement: eng(rs),
        posts: new Set(rs.map((r) => r.target.postId)).size,
        saves: sum(rs, "saves"),
        lastSyncAt: times[a.id]?.lastSyncAt ?? null,
      };
    })
    .sort((a, b) => b.views - a.views);

  // 1140: follower history, per account, from Outlly's own daily snapshots. Two points at least, or the
  // chart says there is no history yet rather than drawing a line through one number.
  const histIds = accountIds ?? accts.map((a) => a.id);
  const snaps = histIds.length ? await accountHistory(histIds, w.from, w.to).catch(() => []) : [];
  const nameOf = new Map(accts.map((a) => [a.id, a]));
  const histAccts = [...new Set(snaps.map((s) => s.accountId))];
  const extra = histAccts.filter((id) => !nameOf.has(id));
  if (extra.length) for (const a of await db.socialAccount.findMany({ where: { id: { in: extra }, userId }, select: { id: true, platform: true, username: true, avatar: true } })) nameOf.set(a.id, a);
  const followerHistory = histAccts.flatMap((id) => {
    const a = nameOf.get(id);
    if (!a || !(PLATFORMS as readonly string[]).includes(a.platform)) return [];
    const points = snaps.filter((s) => s.accountId === id && typeof s.followers === "number").map((s) => ({ date: s.day, value: s.followers as number }));
    if (points.length < 2) return [];
    return [{ accountId: id, platform: a.platform as Platform, username: a.username, metric: (a.platform === "youtube" ? "subscribers" : "followers") as "followers" | "subscribers", points }];
  });

  const connectedRows = await db.socialAccount.findMany({ where: { userId, status: "connected", ...(accountIds ? { id: { in: accountIds } } : {}) }, select: { platform: true } });
  const connectedSet = new Set(connectedRows.map((r) => r.platform));

  return {
    rangeDays: w.days,
    window: w,
    byAccount,
    accountIds,
    totals: { views: sum(cur, "views"), likes: sum(cur, "likes"), comments: sum(cur, "comments"), shares: sum(cur, "shares"), saves: sum(cur, "saves"), engagement: eng(cur) },
    previous: { views: sum(prev, "views"), engagement: eng(prev) },
    series,
    engagementSeries,
    followerHistory,
    byPlatform: PLATFORMS.map((p) => {
      const rs = cur.filter((r) => r.target.platform === p);
      return { platform: p, views: sum(rs, "views"), engagement: eng(rs), posts: new Set(rs.map((r) => r.target.postId)).size, connected: connectedSet.has(p), reader: hasStoredReader(p) };
    }),
    top: topE
      ? {
          postId: topT?.postId ?? topE[1].row.target.postId,
          title: topT?.title || topT?.post.title || topT?.post.hook?.split("\n")[0] || "Untitled",
          thumbnailUrl: topTk ? (thumbs.get(topTk) ?? null) : null,
          views: topE[1].views,
          platform: topE[1].row.target.platform as Platform,
        }
      : null,
    standouts,
    avgViews: perTarget.size ? sum(cur, "views") / perTarget.size : 0,
    bestDay: bestWd && bestWd[1] > 0 ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][bestWd[0]] : null,
    hasData: cur.length > 0,
  };
}
