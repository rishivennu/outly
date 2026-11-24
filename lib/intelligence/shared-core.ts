import type { SharedBaseline } from "./model/scorer-core";

/**
 * R1324 (Phase 6): shared learning, the pure side. Many creators' measured posts become a few anonymised buckets
 * (platform + format, and platform + format + category) that hold medians and counts only. Rules, in order:
 *  - aggregates only: a bucket stores n, how many creators it came from, and quantiles. No ids, no per-creator rows.
 *  - a bucket is published only when enough creators (SHARED_MIN_OWNERS) and posts (SHARED_MIN_POSTS) are in it and
 *    no single creator is more than half of it; thinner buckets are dropped, not padded.
 *  - one creator contributes at most SHARED_OWNER_CAP most-recent posts to a bucket, so a prolific account cannot
 *    become "the cohort".
 *  - the number carried is views per follower (scale-free across accounts); raw views are kept as a fallback for a
 *    creator whose follower count is unknown.
 *  - a shared prior is a prior, never a verdict: the scorer shrinks the creator's own median toward it with their own
 *    sample size as the weight (SHRINK_K), and it is offered only below the personal level.
 * Opting out (User.shareLearning = false) keeps a creator's posts out of every bucket; it never removes their own
 * predictions. Everything here is deterministic.
 */

export const SHARED_VERSION = 1;
export const SHARED_WINDOW_DAYS = 180;
export const SHARED_MIN_OWNERS = 5;
export const SHARED_MIN_POSTS = 20;
export const SHARED_OWNER_CAP = 30;
/** The largest share of a bucket's posts one creator may hold. */
export const SHARED_MAX_OWNER_SHARE = 0.5;
export const SHARED_MAX_BUCKETS = 400;
export const SHARED_MAX_CATEGORIES_PER_ROW = 3;

/** One measured destination, as the aggregator sees it. `owner` is used to count distinct creators and is never stored. */
export interface SharedRow {
  owner: string;
  platform: string;
  format: string;
  publishedAt: string | Date;
  categories: readonly string[];
  views: number | null;
  viewsPerFollower: number | null;
  engagementRate: number | null;
}

export interface SharedStat {
  n: number;
  median: number;
  p25: number;
  p75: number;
}

export interface SharedBucket {
  key: string;
  platform: string;
  format: string;
  /** null = every category on this platform + format. */
  category: string | null;
  n: number;
  owners: number;
  /** Share of the bucket held by its largest contributor, 0..1 (always <= SHARED_MAX_OWNER_SHARE once published). */
  topOwnerShare: number;
  views: SharedStat | null;
  viewsPerFollower: SharedStat | null;
  engagementRate: SharedStat | null;
}

export interface SharedBaselines {
  version: number;
  builtAt: string;
  windowDays: number;
  minOwners: number;
  minPosts: number;
  /** Rows and creators that were considered (after the window and opt-outs). */
  rows: number;
  owners: number;
  buckets: SharedBucket[];
  /** Buckets that existed but were too thin or too concentrated to publish. */
  dropped: number;
}

const time = (d: string | Date) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function statOf(values: number[]): SharedStat | null {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  return { n: v.length, median: r3(quantile(v, 0.5)), p25: r3(quantile(v, 0.25)), p75: r3(quantile(v, 0.75)) };
}

const bucketKey = (platform: string, format: string, category: string | null) => `${platform}|${format}${category ? `|${category}` : ""}`;

/** Build the buckets from measured rows. Rows outside the window, without a platform/format, or with no number are skipped. */
export function buildShared(rows: readonly SharedRow[], now: number | Date = Date.now()): SharedBaselines {
  const at = typeof now === "number" ? now : now.getTime();
  const since = at - SHARED_WINDOW_DAYS * 864e5;
  const usable = rows.filter((r) => r.platform && r.format && time(r.publishedAt) >= since && time(r.publishedAt) <= at && (r.views !== null || r.viewsPerFollower !== null || r.engagementRate !== null));
  // Group: every row lands in its platform+format bucket and in up to a few category buckets.
  const groups = new Map<string, { platform: string; format: string; category: string | null; rows: SharedRow[] }>();
  const add = (platform: string, format: string, category: string | null, r: SharedRow) => {
    const k = bucketKey(platform, format, category);
    const g = groups.get(k) ?? groups.set(k, { platform, format, category, rows: [] }).get(k)!;
    g.rows.push(r);
  };
  for (const r of usable) {
    add(r.platform, r.format, null, r);
    for (const c of [...new Set(r.categories.map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, SHARED_MAX_CATEGORIES_PER_ROW)) add(r.platform, r.format, c, r);
  }
  const buckets: SharedBucket[] = [];
  let dropped = 0;
  for (const g of groups.values()) {
    // Cap each creator to their most recent rows in this bucket.
    const byOwner = new Map<string, SharedRow[]>();
    for (const r of g.rows) (byOwner.get(r.owner) ?? byOwner.set(r.owner, []).get(r.owner)!).push(r);
    const kept: SharedRow[] = [];
    for (const list of byOwner.values()) kept.push(...list.sort((a, b) => time(b.publishedAt) - time(a.publishedAt)).slice(0, SHARED_OWNER_CAP));
    const owners = byOwner.size;
    const n = kept.length;
    const top = Math.max(...[...byOwner.values()].map((l) => Math.min(l.length, SHARED_OWNER_CAP)));
    const topOwnerShare = n ? r3(top / n) : 0;
    if (owners < SHARED_MIN_OWNERS || n < SHARED_MIN_POSTS || topOwnerShare > SHARED_MAX_OWNER_SHARE) {
      dropped++;
      continue;
    }
    buckets.push({
      key: bucketKey(g.platform, g.format, g.category),
      platform: g.platform,
      format: g.format,
      category: g.category,
      n,
      owners,
      topOwnerShare,
      views: statOf(kept.map((r) => r.views).filter((v): v is number => v !== null)),
      viewsPerFollower: statOf(kept.map((r) => r.viewsPerFollower).filter((v): v is number => v !== null)),
      engagementRate: statOf(kept.map((r) => r.engagementRate).filter((v): v is number => v !== null)),
    });
  }
  buckets.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  return {
    version: SHARED_VERSION,
    builtAt: new Date(at).toISOString(),
    windowDays: SHARED_WINDOW_DAYS,
    minOwners: SHARED_MIN_OWNERS,
    minPosts: SHARED_MIN_POSTS,
    rows: usable.length,
    owners: new Set(usable.map((r) => r.owner)).size,
    buckets: buckets.slice(0, SHARED_MAX_BUCKETS),
    dropped: dropped + Math.max(0, buckets.length - SHARED_MAX_BUCKETS),
  };
}

/** Parse a stored ModelVersion.data; null when it is not a shared baselines document of this version. */
export function parseShared(raw: string | null | undefined): SharedBaselines | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SharedBaselines>;
    if (!v || v.version !== SHARED_VERSION || !Array.isArray(v.buckets)) return null;
    return v as SharedBaselines;
  } catch {
    return null;
  }
}

export interface SharedQuery {
  platform: string;
  format: string;
  categories?: readonly string[];
  /** The creator's follower count on this platform, when known; turns views per follower into a view count. */
  followers?: number | null;
  metric?: "views" | "engagementRate";
}

/** The bucket a query reads: the first matching category bucket, else the platform + format one. */
export function pickBucket(b: SharedBaselines | null, q: SharedQuery): SharedBucket | null {
  if (!b) return null;
  for (const c of (q.categories ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    const hit = b.buckets.find((x) => x.platform === q.platform && x.format === q.format && x.category === c);
    if (hit) return hit;
  }
  return b.buckets.find((x) => x.platform === q.platform && x.format === q.format && x.category === null) ?? null;
}

/**
 * The prior the scorer takes for one creator's question, or null when the cohort has nothing publishable. Views come
 * as views-per-follower times the creator's followers; without a follower count the raw cohort median stands in and
 * the source says so.
 */
export function sharedFor(b: SharedBaselines | null, q: SharedQuery): SharedBaseline | null {
  const bucket = pickBucket(b, q);
  if (!bucket) return null;
  const who = `${bucket.owners} creators' ${bucket.n} ${bucket.format} posts on ${bucket.platform}${bucket.category ? ` about ${bucket.category}` : ""}`;
  if ((q.metric ?? "views") === "engagementRate") {
    if (!bucket.engagementRate) return null;
    return { source: `the typical engagement rate across ${who}`, median: bucket.engagementRate.median, n: bucket.engagementRate.n };
  }
  if (q.followers && q.followers > 0 && bucket.viewsPerFollower) return { source: `what accounts your size typically get, from ${who}`, median: Math.round(bucket.viewsPerFollower.median * q.followers), n: bucket.viewsPerFollower.n };
  if (bucket.views) return { source: `the typical views across ${who} (your follower count is not known yet, so this is not scaled to your size)`, median: Math.round(bucket.views.median), n: bucket.views.n };
  return null;
}

/* ------------------------------------------------------------------ governance */

export interface EvaluationRow {
  platform: string;
  week: string;
  n: number;
  medianApe: number | null;
  mape: number | null;
  within: number | null;
  biasPct: number | null;
}

export interface WeekAccuracy {
  week: string;
  /** Creators with an evaluation that week. */
  owners: number;
  n: number;
  /** n-weighted MAPE across creators, %, null when no creator had one. */
  mape: number | null;
  /** n-weighted share of actuals inside the band, %. */
  within: number | null;
  /** n-weighted median signed error, %. Positive = over-predicts. */
  biasPct: number | null;
}

export interface Drift {
  /** The latest 4 weeks against the 4 before them; null when either side is empty. */
  recentMape: number | null;
  priorMape: number | null;
  deltaPts: number | null;
  verdict: "steady" | "improving" | "drifting" | "unknown";
}

const wavg = (pairs: [number | null, number][]) => {
  const ok = pairs.filter((p): p is [number, number] => p[0] !== null && p[1] > 0);
  const w = ok.reduce((s, p) => s + p[1], 0);
  return w ? Math.round((ok.reduce((s, p) => s + p[0] * p[1], 0) / w) * 10) / 10 : null;
};

/** Roll per-creator weekly evaluations (platform "" rows = whole workspace) into one line per week. Aggregates only. */
export function accuracyByWeek(rows: readonly (EvaluationRow & { owner: string })[], opts: { platform?: string | null } = {}): WeekAccuracy[] {
  const want = opts.platform ?? "";
  const byWeek = new Map<string, (EvaluationRow & { owner: string })[]>();
  for (const r of rows) if (r.platform === want) (byWeek.get(r.week) ?? byWeek.set(r.week, []).get(r.week)!).push(r);
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, list]) => ({
      week,
      owners: new Set(list.map((r) => r.owner)).size,
      n: list.reduce((s, r) => s + r.n, 0),
      mape: wavg(list.map((r) => [r.mape, r.n])),
      within: wavg(list.map((r) => [r.within, r.n])),
      biasPct: wavg(list.map((r) => [r.biasPct, r.n])),
    }));
}

/** Week-over-week drift: more than 10 points worse is drifting, more than 10 better is improving. */
export function driftOf(weeks: readonly WeekAccuracy[]): Drift {
  const withMape = weeks.filter((w) => w.mape !== null);
  const recent = withMape.slice(-4);
  const prior = withMape.slice(-8, -4);
  const recentMape = recent.length ? wavg(recent.map((w) => [w.mape, w.n])) : null;
  const priorMape = prior.length ? wavg(prior.map((w) => [w.mape, w.n])) : null;
  if (recentMape === null || priorMape === null) return { recentMape, priorMape, deltaPts: null, verdict: "unknown" };
  const deltaPts = Math.round((recentMape - priorMape) * 10) / 10;
  return { recentMape, priorMape, deltaPts, verdict: deltaPts > 10 ? "drifting" : deltaPts < -10 ? "improving" : "steady" };
}
