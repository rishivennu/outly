import "server-only";
import { db } from "../db";
import { getAnalytics } from "../analytics";
import { analyticsScope, listProfiles } from "../profiles";
import { platformName, type ClientReport } from "../reports/client-report";
import { rangeLabel, type RangeWindow } from "./core";
import type { SessionUser } from "../auth";

/** Most rows a report lists: the standouts a client deck needs, not every post in a long window. */
const POST_ROWS = 200;

/**
 * 1140: a client report for an exact window, so a custom date range on the analytics page exports the same
 * numbers that are on screen. The day-count path still goes through lib/reports/client-report-server.ts
 * (owned elsewhere this round); this builder adds the from/to case and nothing else.
 *
 * Same scope rules as the page: a member only sees the accounts they were given, and `account` narrows to
 * one profile they can see. Every number comes from stored metrics, so nothing here is estimated.
 */
export async function buildRangeReport(user: Pick<SessionUser, "id" | "scope" | "name" | "timezone">, w: RangeWindow, account: string | null): Promise<ClientReport> {
  const ids = await analyticsScope(user, account);
  const [a, profiles] = await Promise.all([getAnalytics(user.id, w.days, ids, { from: w.from, to: w.to, maxDays: w.days }), listProfiles(user.id, user.scope)]);
  const since = new Date(w.from);
  const until = new Date(w.to);

  // Summed per target in the database, so a manager with many accounts never pulls every metric row
  // into memory just to list the posts.
  const sums = await db.targetMetric.groupBy({
    by: ["targetId"],
    where: { capturedAt: { gte: since, lt: until }, target: { post: { userId: user.id }, practice: false, ...(ids ? { socialAccountId: { in: ids } } : {}) } },
    _sum: { views: true, likes: true, comments: true, shares: true },
    orderBy: { _sum: { views: "desc" } },
    take: POST_ROWS,
  });
  const targets = sums.length
    ? await db.postTarget.findMany({
        where: { id: { in: sums.map((s) => s.targetId) } },
        select: { id: true, platform: true, title: true, platformUrl: true, publishedAt: true, socialAccount: { select: { username: true } }, post: { select: { title: true, hook: true } } },
      })
    : [];
  const byId = new Map(targets.map((t) => [t.id, t]));
  const posts = sums.flatMap((s) => {
    const t = byId.get(s.targetId);
    if (!t) return [];
    return [
      {
        title: t.title || t.post.title || t.post.hook || "Untitled",
        platform: t.platform,
        account: t.socialAccount?.username ? `@${t.socialAccount.username}` : "",
        publishedAt: t.publishedAt?.toISOString() ?? null,
        views: s._sum.views ?? 0,
        likes: s._sum.likes ?? 0,
        comments: s._sum.comments ?? 0,
        shares: s._sum.shares ?? 0,
        url: t.platformUrl,
      },
    ];
  });

  const one = ids && ids.length === 1 ? profiles.find((p) => p.id === ids[0]) : null;
  const scope = one ? `@${one.username} on ${platformName(one.platform)}` : ids ? `${ids.length} accounts` : "All accounts";
  const now = new Date();
  return {
    workspace: user.name || "Outlly",
    scope,
    rangeDays: w.days,
    from: w.from,
    to: w.to,
    generatedAt: now.toLocaleString("en-GB", { timeZone: user.timezone || "UTC", dateStyle: "medium", timeStyle: "short" }),
    tz: user.timezone || "UTC",
    totals: a.totals,
    previousViews: a.previous.views,
    byPlatform: a.byPlatform.filter((p) => p.views > 0),
    byAccount: a.byAccount.map((x) => ({ platform: x.platform, username: `@${x.username}`, views: x.views, engagement: x.engagement, posts: x.posts })),
    daily: a.series.map((s) => ({ date: s.date, views: Object.entries(s).reduce((n, [k, v]) => (k === "date" ? n : n + (v as number)), 0) })),
    posts,
  };
}

/** The window in the download's file name, so two exports of the same account never collide. */
export const reportStamp = (w: RangeWindow) => (w.custom ? `${w.from.slice(0, 10)}_${new Date(Date.parse(w.to) - 864e5).toISOString().slice(0, 10)}` : `${w.days}d`);

/** A human label for the window, reused in the report's own header text. */
export const reportRangeLabel = rangeLabel;
