import "server-only";
import { db } from "../db";
import { getAnalytics } from "../analytics";
import { analyticsScope, listProfiles } from "../profiles";
import { platformName, type ClientReport } from "./client-report";
import type { SessionUser } from "../auth";

/** Most rows a report lists. A client deck needs the standouts, not every post in a 90-day window. */
const POST_ROWS = 200;

/**
 * Gather one client report with the same scope rules as the analytics page: a member only ever sees the
 * accounts they were given, and `account` narrows to one profile they can see.
 */
export async function buildClientReport(user: Pick<SessionUser, "id" | "scope" | "name" | "timezone">, days: number, account: string | null): Promise<ClientReport> {
  const ids = await analyticsScope(user, account);
  const [a, profiles] = await Promise.all([getAnalytics(user.id, days, ids), listProfiles(user.id, user.scope)]);
  const now = new Date();
  const since = new Date(now.getTime() - days * 864e5);

  // Per target, summed in the database (groupBy), so a manager with 10 accounts and hundreds of posts
  // never pulls every metric snapshot into memory just to list them.
  const sums = await db.targetMetric.groupBy({
    by: ["targetId"],
    where: { capturedAt: { gte: since }, target: { post: { userId: user.id }, practice: false, ...(ids ? { socialAccountId: { in: ids } } : {}) } },
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
    return [{
      title: t.title || t.post.title || t.post.hook || "Untitled",
      platform: t.platform,
      account: t.socialAccount?.username ? `@${t.socialAccount.username}` : "",
      publishedAt: t.publishedAt?.toISOString() ?? null,
      views: s._sum.views ?? 0,
      likes: s._sum.likes ?? 0,
      comments: s._sum.comments ?? 0,
      shares: s._sum.shares ?? 0,
      url: t.platformUrl,
    }];
  });

  const one = ids && ids.length === 1 ? profiles.find((p) => p.id === ids[0]) : null;
  const scope = one ? `@${one.username} on ${platformName(one.platform)}` : ids ? `${ids.length} accounts` : "All accounts";
  return {
    workspace: user.name || "Outlly",
    scope,
    rangeDays: days,
    from: since.toISOString(),
    to: now.toISOString(),
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
