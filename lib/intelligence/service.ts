import "server-only";
import { db } from "../db";
import { cached } from "../cache";
import { STORED_BY_PLATFORM } from "../analytics/core";
import { analyticsScope } from "../profiles";
import type { SessionUser } from "../auth";
import {
  formatPerformance,
  isObjective,
  periodOf,
  previousPeriod,
  recommendationsFrom,
  topicInsights,
  whatIsWorking,
  whatNeedsAttention,
  type FormatGroup,
  type Objective,
  type Period,
  type PostRecord,
  type Signal,
  type TopicInsight,
} from "./core";
import { getBrandProfile } from "./memory";
import { persistRecommendations, storedFor, type StoredRecommendation } from "./reco";
import { ACTIVE_STATUSES } from "./reco-core";

/**
 * R1236: the Prisma-backed half of Outlly Intelligence. It reads the published posts of one workspace and hands them
 * to the pure engine in ./core.ts, which does every sum, comparison and claim.
 *
 * Decisions this file makes about the rows (the analytics query left them open):
 *  - only published, real destinations count: platformStatus "published", practice false, removedAt null;
 *  - an archived post is kept (R1219: archiving hides a post in the studio, its numbers stay true);
 *  - one PostRecord per destination, because the same video on two platforms is two posts to compare;
 *  - a destination's metrics are the sum of every increment ever captured for it (TargetMetric rows are
 *    increments), not just the ones inside the window: a post's performance is its own total, and the window
 *    decides which posts are in, through their publish date.
 */

type Scoped = Pick<SessionUser, "id" | "scope">;

export interface LoadOpts {
  /** The window of publish dates to load, in days. The previous window of the same length comes too, for fair baselines. */
  days: number;
  /** Accounts to cover; null = the whole workspace. Left out: taken from analyticsScope, like the analytics API does. */
  accountIds?: string[] | null;
  /** Only posts whose ContentItem sits in this brand scope (agency clients). Left out = every post. */
  brandKey?: string;
}

const METRIC_KEYS = ["views", "likes", "comments", "shares", "saves"] as const;
/** R1244: the most destinations one read loads, newest first, so a huge workspace cannot stall the overview. */
export const POSTS_CAP = 2000;

/** The cache key, exported so tests and future invalidation agree on its shape. One minute, like analytics. */
export function postsCacheKey(userId: string, period: Period, accountIds: string[] | null, brandKey?: string): string {
  const ids = accountIds ? [...new Set(accountIds)].sort().join(",") : "all";
  return `intel:posts:${userId}:${previousPeriod(period).from}:${period.to}:${ids}:${brandKey ?? "any"}`;
}

/** Every published destination of this workspace in the window and the one before it, as the engine's input rows. */
export async function loadPostRecords(user: Scoped, opts: LoadOpts): Promise<PostRecord[]> {
  const period = periodOf(Date.now(), opts.days);
  const ids = opts.accountIds !== undefined ? opts.accountIds : await analyticsScope(user);
  return cached(postsCacheKey(user.id, period, ids, opts.brandKey), 60_000, () => computePostRecords(user.id, period, ids, opts.brandKey));
}

async function computePostRecords(userId: string, period: Period, accountIds: string[] | null, brandKey?: string): Promise<PostRecord[]> {
  const from = new Date(previousPeriod(period).from);
  const to = new Date(period.to);
  // A destination's own publish time when the platform gave one, else the post's: filtered here so a post that
  // went live outside the window is never loaded and then dropped.
  const published = { OR: [{ publishedAt: { gte: from, lt: to } }, { publishedAt: null, post: { publishedAt: { gte: from, lt: to } } }] };
  const where = {
    platformStatus: "published",
    practice: false,
    removedAt: null,
    post: { userId, ...(brandKey !== undefined ? { variation: { item: { brandKey, ownerId: userId } } } : {}) },
    ...(accountIds ? { socialAccountId: { in: accountIds } } : {}),
    ...published,
  };
  const targets = await db.postTarget.findMany({
    where,
    // R1244: hard cap, newest first (overview reports postsCapped when it is hit).
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: POSTS_CAP,
    select: {
      id: true,
      platform: true,
      publishedAt: true,
      post: {
        select: {
          id: true,
          format: true,
          publishedAt: true,
          variation: { select: { itemId: true, item: { select: { topic: true, categories: { select: { category: { select: { name: true } } } } } } } },
        },
      },
    },
  });
  if (!targets.length) return [];
  // One grouped read for the numbers, the way computeAnalytics sums increments, but per destination over its whole life.
  const sums = await db.targetMetric.groupBy({
    by: ["targetId"],
    where: { targetId: { in: targets.map((t) => t.id) } },
    _sum: { views: true, likes: true, comments: true, shares: true, saves: true },
  });
  const byTarget = new Map(sums.map((s) => [s.targetId, s._sum]));
  const out: PostRecord[] = [];
  for (const t of targets) {
    const publishedAt = t.publishedAt ?? t.post.publishedAt;
    if (!publishedAt) continue;
    const got = byTarget.get(t.id);
    const stored = STORED_BY_PLATFORM[t.platform] ?? [];
    const metrics: PostRecord["metrics"] = {};
    // Only what this platform's reader can ever give: everything else stays absent, so the engine calls it
    // unavailable instead of reading a missing number as 0.
    for (const k of METRIC_KEYS) if (stored.includes(k)) metrics[k] = got ? (got[k] ?? 0) : null;
    const item = t.post.variation?.item;
    out.push({
      id: t.id,
      itemId: t.post.variation?.itemId ?? null,
      platform: t.platform,
      format: t.post.format,
      publishedAt: publishedAt.toISOString(),
      topic: item?.topic ?? null,
      categories: item?.categories.map((c) => c.category.name) ?? [],
      metrics,
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface Overview {
  period: Period;
  previous: Period;
  objective: Objective;
  /** Published destinations in the current period (the previous period is only a baseline). */
  posts: number;
  /** Destinations loaded, both periods: what every comparison was computed from. */
  postsAnalyzed: number;
  formats: FormatGroup[];
  topics: TopicInsight[];
  working: Signal[];
  attention: Signal[];
  /** R1239: the stored rows behind the engine's drafts (id, status, wordedBy), still active ones only. */
  recommendations: StoredRecommendation[];
  /** Why the list is empty, when it is. */
  recommendationsReason: string | null;
  /** R1244: true when POSTS_CAP destinations were loaded, so older ones in the window were left out. */
  postsCapped: boolean;
  generatedAt: string;
}

export interface OverviewOpts {
  days: number;
  /** Overrides the workspace objective for this read only; nothing is saved. */
  objective?: string;
  accountIds?: string[] | null;
  brandKey?: string;
  /** R1244: for Pip. Matches drafts to rows already stored and writes nothing (no new rows, events, expiry or wording). */
  readOnly?: boolean;
}

/**
 * The Content Intelligence read model for one workspace: the objective it is judged against, like-with-like format
 * and topic stats, what is working, what needs attention, and the recommendation drafts those signals support.
 * Deterministic: the same posts and the same objective always give the same answer.
 */
export async function overview(user: Scoped, opts: OverviewOpts): Promise<Overview> {
  const period = periodOf(Date.now(), opts.days);
  const previous = previousPeriod(period);
  const brand = await getBrandProfile(user.id, opts.brandKey ?? "");
  // The objective decides which metrics matter. Engagement is the fallback: it is the one thing every reporting
  // platform gives, so nothing is claimed from a metric the account cannot see.
  const objective: Objective = isObjective(opts.objective) ? opts.objective : (brand?.objective ?? "engagement");
  const posts = await loadPostRecords(user, { days: opts.days, accountIds: opts.accountIds, brandKey: opts.brandKey });
  const working = whatIsWorking(posts, objective, period);
  const attention = whatNeedsAttention(posts, objective, period);
  const me = await db.user.findUnique({ where: { id: user.id }, select: { name: true, niche: true } });
  const drafts = recommendationsFrom(working, { name: brand?.name ?? me?.name ?? null, niche: me?.niche ?? null });
  // R1239: stored idempotently, so the dashboard can link /create?rec=<id>. Rejected, done and expired rows are not shown.
  const stored = opts.readOnly
    ? await storedFor(user.id, opts.brandKey ?? "", drafts.recommendations, period)
    : await persistRecommendations(user.id, opts.brandKey ?? "", drafts.recommendations, period);
  const recommendations = stored.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const reason = recommendations.length ? null : (drafts.reason ?? "Nothing new to suggest yet: you have already closed the recommendations these numbers support.");
  const curFrom = Date.parse(period.from);
  const inCur = posts.filter((p) => Date.parse(String(p.publishedAt)) >= curFrom);
  return {
    period,
    previous,
    objective,
    posts: inCur.length,
    postsAnalyzed: posts.length,
    formats: formatPerformance(inCur, objective),
    topics: topicInsights(inCur, objective),
    working,
    attention,
    recommendations,
    recommendationsReason: reason,
    postsCapped: posts.length >= POSTS_CAP,
    generatedAt: new Date().toISOString(),
  };
}
