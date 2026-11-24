import "server-only";
import { db } from "../db";
import { STORED_BY_PLATFORM } from "../analytics/core";
import type { PostRecord } from "./core";
import { extractFeatures, extractPerf, FEATURE_VERSION, type FeatureInput } from "./features-core";

/**
 * R1318: the Prisma half of feature extraction. One published destination becomes one ContentFeature row; the row is
 * recomputed while the post is still young (its numbers move) and whenever FEATURE_VERSION moves. Everything is
 * filtered by the owner (Post.userId): a target of another workspace is never read.
 */

/** Posts up to this old are recomputed every REFRESH_EVERY_MS; older ones only on a version bump. */
export const YOUNG_DAYS = 35;
export const REFRESH_EVERY_MS = 24 * 36e5;
/** How far back the first run looks. Same as the Content Memory backfill, so both read the same posts. */
export const FEATURE_WINDOW_DAYS = 180;
const METRIC_KEYS = ["views", "likes", "comments", "shares", "saves"] as const;

const live = (since: Date) => ({
  platformStatus: "published",
  practice: false,
  removedAt: null,
  OR: [{ publishedAt: { gte: since } }, { publishedAt: null, post: { publishedAt: { gte: since } } }],
});

export interface RefreshResult {
  scanned: number;
  written: number;
  skipped: number;
}

/** The destinations of `ownerId` that need a (re)computed row, oldest publish first, at most `batch`. */
export async function refreshFeatures(ownerId: string, opts: { batch?: number; now?: Date | number } = {}): Promise<RefreshResult> {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const batch = Math.max(1, Math.min(500, Math.floor(opts.batch ?? 100) || 100));
  const since = new Date(now - FEATURE_WINDOW_DAYS * 864e5);
  const targets = await db.postTarget.findMany({
    where: { post: { userId: ownerId }, ...live(since) },
    orderBy: [{ publishedAt: "asc" }, { createdAt: "asc" }],
    take: 2000,
    select: {
      id: true,
      platform: true,
      publishedAt: true,
      title: true,
      caption: true,
      description: true,
      hashtags: true,
      firstComment: true,
      socialAccountId: true,
      post: {
        select: {
          id: true,
          format: true,
          publishedAt: true,
          hook: true,
          coverKey: true,
          media: { select: { duration: true, width: true, height: true } },
          _count: { select: { items: true, targets: true } },
          variation: { select: { kind: true, itemId: true, item: { select: { topic: true, categories: { select: { category: { select: { name: true } } } } } } } },
        },
      },
    },
  });
  if (!targets.length) return { scanned: 0, written: 0, skipped: 0 };
  const ids = targets.map((t) => t.id);
  const existing = new Map((await db.contentFeature.findMany({ where: { targetId: { in: ids } }, select: { targetId: true, version: true, computedAt: true, publishedAt: true } })).map((r) => [r.targetId, r]));
  const due = targets.filter((t) => {
    const row = existing.get(t.id);
    if (!row) return true;
    if (row.version !== FEATURE_VERSION) return true;
    const age = now - row.publishedAt.getTime();
    return age < YOUNG_DAYS * 864e5 && now - row.computedAt.getTime() >= REFRESH_EVERY_MS;
  });
  const work = due.slice(0, batch);
  if (!work.length) return { scanned: targets.length, written: 0, skipped: targets.length };
  const sums = await db.targetMetric.groupBy({ by: ["targetId"], where: { targetId: { in: work.map((t) => t.id) } }, _sum: { views: true, likes: true, comments: true, shares: true, saves: true } });
  const byTarget = new Map(sums.map((s) => [s.targetId, s._sum]));
  const user = await db.user.findUnique({ where: { id: ownerId }, select: { timezone: true } });
  // Followers on the publish day, per account, one grouped read.
  const dayOf = (d: Date) => d.toISOString().slice(0, 10);
  const wantDays = new Map<string, Set<string>>();
  for (const t of work) {
    const at = t.publishedAt ?? t.post.publishedAt;
    if (t.socialAccountId && at) (wantDays.get(t.socialAccountId) ?? wantDays.set(t.socialAccountId, new Set()).get(t.socialAccountId)!).add(dayOf(at));
  }
  const snaps = wantDays.size
    ? await db.accountSnapshot.findMany({ where: { OR: [...wantDays].map(([accountId, days]) => ({ accountId, day: { in: [...days] } })) }, select: { accountId: true, day: true, followers: true } })
    : [];
  const followers = new Map(snaps.map((s) => [`${s.accountId}:${s.day}`, s.followers]));
  // Previous publish per platform for the gap: walk every target of the owner in order (they are sorted asc).
  const prevByPlatform = new Map<string, Date>();
  const previous = new Map<string, Date | null>();
  for (const t of targets) {
    const at = t.publishedAt ?? t.post.publishedAt;
    if (!at) continue;
    previous.set(t.id, prevByPlatform.get(t.platform) ?? null);
    prevByPlatform.set(t.platform, at);
  }
  let written = 0;
  for (const t of work) {
    const publishedAt = t.publishedAt ?? t.post.publishedAt;
    if (!publishedAt) continue;
    const got = byTarget.get(t.id);
    const stored = STORED_BY_PLATFORM[t.platform] ?? [];
    const metrics: PostRecord["metrics"] = {};
    for (const k of METRIC_KEYS) if (stored.includes(k)) metrics[k] = got ? (got[k] ?? 0) : null;
    const item = t.post.variation?.item;
    const record: PostRecord = {
      id: t.id,
      itemId: t.post.variation?.itemId ?? null,
      platform: t.platform,
      format: t.post.format,
      publishedAt: publishedAt.toISOString(),
      topic: item?.topic ?? null,
      categories: item?.categories.map((c) => c.category.name) ?? [],
      metrics,
    };
    const input: FeatureInput = {
      record,
      title: t.title,
      caption: t.caption,
      description: t.description,
      hashtags: t.hashtags,
      hook: t.post.hook,
      firstComment: t.firstComment,
      coverKey: t.post.coverKey,
      media: t.post.media,
      slides: t.post._count.items,
      timezone: user?.timezone,
      previousPublishedAt: previous.get(t.id) ?? null,
      crossPosted: t.post._count.targets,
      isAdapted: t.post.variation?.kind === "adapted",
      followersAtPublish: t.socialAccountId ? (followers.get(`${t.socialAccountId}:${dayOf(publishedAt)}`) ?? null) : null,
    };
    const features = extractFeatures(input);
    const perf = extractPerf(record, now, input.followersAtPublish);
    const data = { ownerId, postId: t.post.id, platform: t.platform, format: t.post.format, publishedAt, version: FEATURE_VERSION, features: JSON.stringify(features), perf: JSON.stringify(perf), measured: perf.measured, computedAt: new Date(now) };
    await db.contentFeature.upsert({ where: { targetId: t.id }, create: { targetId: t.id, ...data }, update: data });
    written++;
  }
  return { scanned: targets.length, written, skipped: targets.length - written };
}

/** The owner's feature rows of the last `days`, as the profile builder reads them. Scoped by ownerId; optional accounts narrow it. */
export async function loadFeatureRows(ownerId: string, opts: { days: number; now?: Date | number; postIds?: string[] | null }) {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  return db.contentFeature.findMany({
    where: { ownerId, publishedAt: { gte: new Date(now - opts.days * 864e5), lt: new Date(now) }, ...(opts.postIds ? { postId: { in: opts.postIds } } : {}) },
    orderBy: { publishedAt: "asc" },
    take: 3000,
    select: { targetId: true, postId: true, platform: true, format: true, publishedAt: true, features: true, perf: true, measured: true },
  });
}
