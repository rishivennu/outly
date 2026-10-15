import "server-only";
import { db } from "../db";
import { PLATFORM_META, isPlatform } from "../domain";
import { isPracticeAccount } from "../social/registry";
import { postView } from "../services";
import { nextSteps, pickRecyclable, weekStart } from "./core";
import { goalFor } from "./sweep";

const label = (p: { title: string | null; hook: string | null }) => (p.title || p.hook || "Untitled post").split("\n")[0].slice(0, 70);

/** Everything the Home "what to do next" area needs, in one round of queries. */
export async function homeRetention(u: { id: string; postingGoal: number; timezone: string }, now = new Date()) {
  const soon = new Date(now.getTime() + 7 * 864e5);
  const monday = weekStart(now, u.timezone);
  const sunday = new Date(monday.getTime() + 7 * 864e5);
  const [goal, failed, accounts, drafts, scheduledThisWeek, ideas, published, old] = await Promise.all([
    goalFor(u, now),
    db.post.count({ where: { userId: u.id, status: { in: ["failed", "partial"] }, targets: { some: { platformStatus: "failed", practice: false } } } }),
    db.socialAccount.findMany({ where: { userId: u.id, status: { in: ["connected", "needs_reconnect"] } }, select: { platform: true, platformUserId: true, status: true, refreshToken: true, tokenExpiresAt: true } }),
    db.post.findMany({ where: { userId: u.id, status: "draft" }, select: { id: true, title: true, hook: true }, orderBy: { updatedAt: "desc" }, take: 3 }),
    db.post.count({ where: { userId: u.id, status: "scheduled", scheduledAt: { gte: now, lt: sunday } } }),
    db.idea.count({ where: { userId: u.id, doneAt: null } }),
    db.post.count({ where: { userId: u.id, status: { in: ["published", "partial"] } } }),
    db.postTarget.findMany({
      where: { post: { userId: u.id }, practice: false, platformStatus: "published", publishedAt: { lte: new Date(now.getTime() - 21 * 864e5) } },
      select: { postId: true, publishedAt: true, metrics: { orderBy: { capturedAt: "desc" }, take: 1, select: { views: true } } },
      take: 400,
    }),
  ]);
  const real = accounts.filter((a) => !isPracticeAccount(a));
  const name = (p: string) => (isPlatform(p) ? PLATFORM_META[p].name : p);
  const byPost = new Map<string, { id: string; views: number; publishedAt: Date | null }>();
  for (const t of old) {
    const cur = byPost.get(t.postId) ?? { id: t.postId, views: 0, publishedAt: t.publishedAt };
    cur.views += t.metrics[0]?.views ?? 0;
    if (t.publishedAt && (!cur.publishedAt || t.publishedAt < cur.publishedAt)) cur.publishedAt = t.publishedAt;
    byPost.set(t.postId, cur);
  }
  const picks = pickRecyclable([...byPost.values()], now);
  const recyclePosts = picks.length ? await db.post.findMany({ where: { id: { in: picks.map((p) => p.id) }, userId: u.id }, include: { targets: true, media: true } }) : [];
  const views = new Map(picks.map((p) => [p.id, p]));
  const recycle = (await Promise.all(recyclePosts.map(postView)))
    .map((p) => ({ id: p.id, title: label(p), thumb: p.media.thumbnailUrl, views: views.get(p.id)?.views ?? 0, publishedAt: views.get(p.id)?.publishedAt?.toISOString() ?? null, platforms: p.targets.map((t) => t.platform) }))
    .sort((a, b) => b.views - a.views);

  const steps = nextSteps({
    failed,
    reconnect: real.filter((a) => a.status === "needs_reconnect").map((a) => ({ platform: a.platform, name: name(a.platform) })),
    expiring: real
      .filter((a) => a.status === "connected" && !a.refreshToken && a.tokenExpiresAt && a.tokenExpiresAt > now && a.tokenExpiresAt < soon)
      .map((a) => ({ platform: a.platform, name: name(a.platform), days: Math.max(1, Math.ceil((a.tokenExpiresAt!.getTime() - now.getTime()) / 864e5)) })),
    connected: real.length,
    published,
    drafts: drafts.map((d) => ({ id: d.id, title: label(d) })),
    scheduledThisWeek,
    goal,
    ideas,
    recyclable: recycle[0] ? { id: recycle[0].id, title: recycle[0].title } : null,
  });
  return { steps, goal, recycle, ideas, published, scheduledThisWeek };
}
export type HomeRetention = Awaited<ReturnType<typeof homeRetention>>;
