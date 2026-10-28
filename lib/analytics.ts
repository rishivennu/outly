import "server-only";
import { db } from "./db";
import { cached } from "./cache";
import { storage } from "./storage";
import { PLATFORMS, type Platform } from "./domain";

export interface AnalyticsSummary {
  rangeDays: number;
  totals: { views: number; likes: number; comments: number; shares: number; engagement: number };
  previous: { views: number; engagement: number };
  series: ({ date: string } & Record<Platform, number>)[];
  byPlatform: { platform: Platform; views: number; engagement: number }[];
  top: { postId: string; title: string; thumbnailUrl: string | null; views: number; platform: Platform } | null;
  bestDay: string | null;
  hasData: boolean;
  /** 1037: the same numbers per connected account, for the combined view's drilldown. Biggest first. */
  byAccount: { accountId: string; platform: Platform; username: string; avatar: string | null; views: number; engagement: number; posts: number }[];
  /** The accounts these numbers cover; null = every account. */
  accountIds: string[] | null;
}

/** Metrics only change when the sync job writes them, so a 60 s per-creator copy makes range switches and revisits instant. */
export function getAnalytics(userId: string, rangeDays = 30, accountIds: string[] | null = null): Promise<AnalyticsSummary> {
  const ids = accountIds ? [...new Set(accountIds)].sort() : null;
  return cached(`analytics:${userId}:${rangeDays}:${ids ? ids.join(",") : "all"}`, 60_000, () => computeAnalytics(userId, rangeDays, ids));
}

async function computeAnalytics(userId: string, rangeDays: number, accountIds: string[] | null): Promise<AnalyticsSummary> {
  const now = Date.now();
  const since = new Date(now - rangeDays * 864e5);
  const prevSince = new Date(now - 2 * rangeDays * 864e5);
  // Numbers only (10-14 perf): the post title and thumbnail used to ride along on every metric row,
  // which multiplied the payload by the number of snapshots. Only the top post needs them, fetched below.
  const rows = await db.targetMetric.findMany({
    where: { capturedAt: { gte: prevSince }, target: { post: { userId }, ...(accountIds ? { socialAccountId: { in: accountIds } } : {}) } },
    select: { capturedAt: true, views: true, likes: true, comments: true, shares: true, target: { select: { platform: true, postId: true, socialAccountId: true } } },
  });

  const cur = rows.filter((r) => r.capturedAt >= since);
  const prev = rows.filter((r) => r.capturedAt < since);
  const sum = (rs: typeof rows, k: "views" | "likes" | "comments" | "shares") => rs.reduce((a, r) => a + r[k], 0);
  const eng = (rs: typeof rows) => {
    const v = sum(rs, "views");
    return v ? ((sum(rs, "likes") + sum(rs, "comments") + sum(rs, "shares")) / v) * 100 : 0;
  };

  const days = new Map<string, Record<Platform, number>>();
  for (let i = rangeDays - 1; i >= 0; i--) days.set(new Date(now - i * 864e5).toISOString().slice(0, 10), Object.fromEntries(PLATFORMS.map((p) => [p, 0])) as Record<Platform, number>);
  for (const r of cur) {
    const d = days.get(r.capturedAt.toISOString().slice(0, 10));
    if (d && (PLATFORMS as readonly string[]).includes(r.target.platform)) d[r.target.platform as Platform] += r.views;
  }
  const series = [...days].map(([date, v]) => ({ date, ...v }));

  const perPost = new Map<string, { views: number; row: (typeof rows)[number] }>();
  for (const r of cur) {
    const k = `${r.target.postId}:${r.target.platform}`;
    const e = perPost.get(k) ?? { views: 0, row: r };
    e.views += r.views;
    perPost.set(k, e);
  }
  const topE = [...perPost.values()].sort((a, b) => b.views - a.views)[0];

  const weekday = new Map<number, number>();
  for (const s of series) {
    const wd = new Date(s.date).getDay();
    weekday.set(wd, (weekday.get(wd) ?? 0) + s.instagram + s.youtube + s.x);
  }
  const bestWd = [...weekday].sort((a, b) => b[1] - a[1])[0];

  const topPost = topE ? await db.post.findUnique({ where: { id: topE.row.target.postId }, select: { title: true, hook: true, media: { select: { thumbnailKey: true } } } }) : null;
  const tk = topPost?.media.thumbnailKey;
  const topThumb = !tk ? null : tk.startsWith("/") ? tk : await storage.signedUrl(tk, 6 * 3600).catch(() => null);

  // Per account (1037). One small query for names; numbers come from the rows already loaded.
  const acctIds = [...new Set(cur.map((r) => r.target.socialAccountId).filter((x): x is string => !!x))];
  const accts = acctIds.length ? await db.socialAccount.findMany({ where: { id: { in: acctIds }, userId }, select: { id: true, platform: true, username: true, avatar: true } }) : [];
  const byAccount = accts
    .filter((a) => (PLATFORMS as readonly string[]).includes(a.platform))
    .map((a) => {
      const rs = cur.filter((r) => r.target.socialAccountId === a.id);
      return { accountId: a.id, platform: a.platform as Platform, username: a.username, avatar: a.avatar, views: sum(rs, "views"), engagement: eng(rs), posts: new Set(rs.map((r) => r.target.postId)).size };
    })
    .sort((a, b) => b.views - a.views);

  return {
    rangeDays,
    byAccount,
    accountIds,
    totals: { views: sum(cur, "views"), likes: sum(cur, "likes"), comments: sum(cur, "comments"), shares: sum(cur, "shares"), engagement: eng(cur) },
    previous: { views: sum(prev, "views"), engagement: eng(prev) },
    series,
    byPlatform: PLATFORMS.map((p) => {
      const rs = cur.filter((r) => r.target.platform === p);
      return { platform: p, views: sum(rs, "views"), engagement: eng(rs) };
    }),
    top: topE
      ? { postId: topE.row.target.postId, title: topPost?.title ?? topPost?.hook ?? "Untitled", thumbnailUrl: topThumb, views: topE.views, platform: topE.row.target.platform as Platform }
      : null,
    bestDay: bestWd && bestWd[1] > 0 ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][bestWd[0]] : null,
    hasData: cur.length > 0,
  };
}
