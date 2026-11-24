import "server-only";
import { db } from "../db";
import { FEATURE_VERSION, parseFeatures, parsePerf } from "./features-core";
import type { SharedBaseline } from "./model/scorer-core";
import { accuracyByWeek, buildShared, driftOf, parseShared, sharedFor, type Drift, type SharedBaselines, type SharedBucket, type SharedQuery, type SharedRow, type WeekAccuracy } from "./shared-core";

/**
 * R1324 (Phase 6): shared learning, the stored side. One sweep reads the measured ContentFeature rows of creators who
 * have not opted out, builds the anonymised buckets (shared-core.ts) and stores them as one ModelVersion row
 * (SHARED_MODEL_KEY, data = JSON). Readers take that document, never the rows, so a creator's numbers leave their
 * workspace only as part of a median over many. The admin governance view is built from the same document plus
 * per-week accuracy rollups: counts and percentages, no creator named.
 */

export const SHARED_MODEL_KEY = "shared-baselines-1";
/** The sweep reads at most this many rows (newest first); plenty for the window at today's volume. */
export const SHARED_MAX_ROWS = 50_000;
const CACHE_MS = 5 * 60_000;

let cache: { at: number; value: SharedBaselines | null } | null = null;

/** Creators who opted out of contributing. Their predictions still read the shared priors; only their rows stay home. */
async function optedOutIds(): Promise<string[]> {
  const rows = await db.user.findMany({ where: { shareLearning: false }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Rebuild the shared baselines from scratch and store them. Idempotent; safe to run from the sweep or the admin page. */
export async function rebuildShared(opts: { now?: Date | number } = {}): Promise<{ baselines: SharedBaselines; optedOut: number }> {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const out = await optedOutIds();
  const since = new Date(now - 180 * 864e5);
  const raw = await db.contentFeature.findMany({
    where: { measured: true, publishedAt: { gte: since, lte: new Date(now) }, ...(out.length ? { ownerId: { notIn: out } } : {}) },
    select: { ownerId: true, platform: true, format: true, publishedAt: true, features: true, perf: true },
    orderBy: { publishedAt: "desc" },
    take: SHARED_MAX_ROWS,
  });
  const rows: SharedRow[] = [];
  for (const r of raw) {
    const perf = parsePerf(r.perf);
    if (!perf?.measured) continue;
    const f = parseFeatures(r.features);
    rows.push({ owner: r.ownerId, platform: r.platform, format: r.format, publishedAt: r.publishedAt, categories: f?.categories ?? [], views: typeof perf.totals.views === "number" ? perf.totals.views : null, viewsPerFollower: perf.viewsPerFollower, engagementRate: perf.engagementRate });
  }
  const baselines = buildShared(rows, now);
  const notes = `Anonymised cohort baselines: ${baselines.buckets.length} buckets from ${baselines.owners} creators' ${baselines.rows} measured posts (last ${baselines.windowDays} days; >= ${baselines.minOwners} creators and ${baselines.minPosts} posts per bucket, no creator above half). ${out.length} opted out.`;
  await db.modelVersion.upsert({
    where: { key: SHARED_MODEL_KEY },
    create: { key: SHARED_MODEL_KEY, kind: "shared", featureVersion: FEATURE_VERSION, status: "active", notes, data: JSON.stringify(baselines) },
    update: { featureVersion: FEATURE_VERSION, notes, data: JSON.stringify(baselines) },
  });
  cache = { at: Date.now(), value: baselines };
  return { baselines, optedOut: out.length };
}

/** The stored shared baselines, cached for a few minutes per instance. Null until the first rebuild. */
export async function loadShared(opts: { fresh?: boolean } = {}): Promise<SharedBaselines | null> {
  if (!opts.fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const row = await db.modelVersion.findUnique({ where: { key: SHARED_MODEL_KEY }, select: { data: true, status: true } });
  const value = row && row.status === "active" ? parseShared(row.data) : null;
  cache = { at: Date.now(), value };
  return value;
}

/** For tests and the sweep: forget the per-instance cache. */
export function resetSharedCache() {
  cache = null;
}

/** The creator's latest known follower count on a platform (newest AccountSnapshot across their connected accounts), or null. */
export async function followersOn(ownerId: string, platform: string): Promise<number | null> {
  const accounts = await db.socialAccount.findMany({ where: { userId: ownerId, platform, status: { not: "disconnected" } }, select: { id: true } });
  if (!accounts.length) return null;
  const snaps = await db.accountSnapshot.findMany({ where: { accountId: { in: accounts.map((a) => a.id) }, followers: { not: null } }, orderBy: { day: "desc" }, take: accounts.length, select: { accountId: true, followers: true } });
  const seen = new Set<string>();
  let total = 0;
  for (const s of snaps) if (!seen.has(s.accountId)) (seen.add(s.accountId), (total += s.followers ?? 0));
  return total > 0 ? total : null;
}

/** The shared prior for one creator's question: the bucket, scaled to their follower count when known. */
export async function sharedPriorFor(ownerId: string, q: Omit<SharedQuery, "followers">): Promise<SharedBaseline | null> {
  const b = await loadShared();
  if (!b) return null;
  const followers = await followersOn(ownerId, q.platform);
  return sharedFor(b, { ...q, followers });
}

/* ------------------------------------------------------------------ governance */

export interface IntelligenceGovernance {
  shared: { stored: boolean; builtAt: string | null; rows: number; owners: number; buckets: SharedBucket[]; dropped: number; windowDays: number; minOwners: number; minPosts: number } | null;
  participation: { creators: number; optedOut: number; withMeasuredPosts: number };
  versions: { key: string; kind: string; featureVersion: number; status: string; notes: string | null; createdAt: string }[];
  predictions: { total: number; evaluated: number; byPlatform: { platform: string; total: number; evaluated: number }[] };
  accuracy: WeekAccuracy[];
  drift: Drift;
  modelKey: string;
}

/** The admin's view: aggregates only. No creator, post or prediction is named. */
export async function intelligenceGovernance(opts: { modelKey: string; weeks?: number }): Promise<IntelligenceGovernance> {
  const weeks = Math.max(4, Math.min(26, opts.weeks ?? 12));
  const [shared, versions, creators, optedOut, measuredOwners, predAll, predEval, evals] = await Promise.all([
    loadShared({ fresh: true }),
    db.modelVersion.findMany({ orderBy: { createdAt: "asc" }, take: 20, select: { key: true, kind: true, featureVersion: true, status: true, notes: true, createdAt: true } }),
    db.user.count(),
    db.user.count({ where: { shareLearning: false } }),
    db.contentFeature.groupBy({ by: ["ownerId"], where: { measured: true }, _count: { _all: true } }).then((g) => g.length),
    db.predictionRecord.groupBy({ by: ["platform"], where: { modelKey: opts.modelKey }, _count: { _all: true } }),
    db.predictionRecord.groupBy({ by: ["platform"], where: { modelKey: opts.modelKey, evaluatedAt: { not: null } }, _count: { _all: true } }),
    db.intelligenceEvaluation.findMany({ where: { modelKey: opts.modelKey, platform: "" }, orderBy: { week: "desc" }, take: 5_000, select: { ownerId: true, platform: true, week: true, n: true, medianApe: true, mape: true, within: true, biasPct: true } }),
  ]);
  const evalBy = new Map(predEval.map((p) => [p.platform, p._count._all]));
  const byPlatform = predAll.map((p) => ({ platform: p.platform, total: p._count._all, evaluated: evalBy.get(p.platform) ?? 0 })).sort((a, b) => b.total - a.total);
  const accuracy = accuracyByWeek(evals.map((e) => ({ owner: e.ownerId, platform: e.platform, week: e.week, n: e.n, medianApe: e.medianApe, mape: e.mape, within: e.within, biasPct: e.biasPct }))).slice(-weeks);
  return {
    shared: shared ? { stored: true, builtAt: shared.builtAt, rows: shared.rows, owners: shared.owners, buckets: shared.buckets, dropped: shared.dropped, windowDays: shared.windowDays, minOwners: shared.minOwners, minPosts: shared.minPosts } : null,
    participation: { creators, optedOut, withMeasuredPosts: measuredOwners },
    versions: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
    predictions: { total: byPlatform.reduce((s, p) => s + p.total, 0), evaluated: byPlatform.reduce((s, p) => s + p.evaluated, 0), byPlatform },
    accuracy,
    drift: driftOf(accuracy),
    modelKey: opts.modelKey,
  };
}

/** The sweep's hourly slot: rebuild once an hour (never fatal to the caller). */
export async function sweepShared(now: Date = new Date()): Promise<{ buckets: number; rows: number } | null> {
  if (now.getMinutes() !== 12) return null;
  const { baselines } = await rebuildShared({ now });
  return { buckets: baselines.buckets.length, rows: baselines.rows };
}
