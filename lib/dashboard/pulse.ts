import "server-only";
import { db } from "../db";
import { cached } from "../cache";
import { storage } from "../storage";
import { PLATFORMS } from "../domain";
import { bucket, type Pulse, type PulseRange, type TopPost } from "./pulse-core";

/** Same 60 s per-creator copy as Analytics: metrics only change when the sync job writes them. */
export function getPulse(userId: string, days: PulseRange, accountIds: string[] | null): Promise<Pulse> {
  const ids = accountIds ? [...new Set(accountIds)].sort() : null;
  return cached(`pulse:${userId}:${days}:${ids ? ids.join(",") : "all"}`, 60_000, () => compute(userId, days, ids));
}

async function compute(userId: string, days: PulseRange, accountIds: string[] | null): Promise<Pulse> {
  const now = Date.now();
  const since = new Date(now - 2 * days * 864e5 - 864e5); // a day of slack: the oldest day key starts before `since`
  const acct = accountIds ? { socialAccountId: { in: accountIds } } : {};
  const [metrics, sent, accounts] = await Promise.all([
    db.targetMetric.findMany({
      where: { capturedAt: { gte: since }, target: { post: { userId }, practice: false, ...acct } },
      select: { capturedAt: true, views: true, likes: true, comments: true, shares: true, target: { select: { platform: true, postId: true } } },
    }),
    db.postTarget.findMany({
      where: { publishedAt: { gte: since }, platformStatus: "published", practice: false, post: { userId }, ...acct },
      select: { publishedAt: true, platform: true },
    }),
    db.socialAccount.findMany({ where: { userId, ...(accountIds ? { id: { in: accountIds } } : {}) }, select: { platform: true } }),
  ]);
  const seen = new Set<string>([...accounts.map((a) => a.platform), ...metrics.map((m) => m.target.platform)]);
  const platforms = PLATFORMS.filter((p) => seen.has(p));
  const b = bucket(
    now,
    days,
    platforms,
    metrics.map((m) => ({ at: m.capturedAt.getTime(), platform: m.target.platform, postId: m.target.postId, views: m.views, likes: m.likes, comments: m.comments, shares: m.shares })),
    sent.map((s) => ({ at: s.publishedAt!.getTime(), platform: s.platform })),
  );

  // Top five overall and per platform; one query and one signing batch for every post that made a list.
  const lists: Record<string, typeof b.ranked> = { all: b.ranked.slice(0, 5) };
  for (const p of platforms) lists[p] = b.ranked.filter((r) => r.platform === p).slice(0, 5);
  const postIds = [...new Set(Object.values(lists).flat().map((r) => r.postId))];
  const posts = postIds.length
    ? await db.post.findMany({ where: { id: { in: postIds }, userId }, select: { id: true, title: true, hook: true, media: { select: { thumbnailKey: true } } } })
    : [];
  const thumbs = new Map(
    await Promise.all(
      posts.map(async (p) => {
        const k = p.media?.thumbnailKey;
        const url = !k ? null : k.startsWith("/") ? k : await storage.signedUrl(k, 6 * 3600).catch(() => null);
        return [p.id, url] as const;
      }),
    ),
  );
  const byId = new Map(posts.map((p) => [p.id, p]));
  const top: Record<string, TopPost[]> = {};
  for (const [k, rs] of Object.entries(lists))
    top[k] = rs.filter((r) => byId.has(r.postId)).map((r) => ({ postId: r.postId, platform: r.platform, views: r.views, title: byId.get(r.postId)!.title ?? byId.get(r.postId)!.hook ?? "Untitled", thumbnailUrl: thumbs.get(r.postId) ?? null }));

  return { days, dates: b.dates, platforms, cur: b.cur, prev: b.prev, top, hasData: metrics.length > 0 || sent.length > 0 };
}
