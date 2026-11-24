import "server-only";
import { db } from "../db";
import { FEATURE_VERSION, parseFeatures, parsePerf } from "./features-core";
import type { SharedBaseline } from "./model/scorer-core";
import { buildShared, driftOf, parseShared, SHARED_WINDOW_DAYS, sharedCutoff, sharedFor, weeklyAccuracy, type Drift, type SharedBaselines, type SharedBucket, type SharedQuery, type SharedRow, type WeekAccuracy } from "./shared-core";

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
/** The sweep rebuilds once the stored document is this old (hourly, from whichever sweep tick comes first). */
export const SHARED_REBUILD_MS = 55 * 60_000;

let cache: { at: number; value: SharedBaselines | null } | null = null;

/** Creators who opted out of contributing. Their predictions still read the shared priors; only their rows stay home. */
async function optedOutIds(): Promise<string[]> {
  const rows = await db.user.findMany({ where: { shareLearning: false }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Rebuild the shared baselines from scratch and store them. Idempotent; safe to run from the sweep or the admin page.
 * The document's status is left as the admin set it: a retired document is refreshed in the row but served to nobody
 * (the cache only takes an active one), so retiring sticks until an admin brings it back.
 */
export async function rebuildShared(opts: { now?: Date | number } = {}): Promise<{ baselines: SharedBaselines; optedOut: number; status: string }> {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const out = await optedOutIds();
  const since = new Date(now - SHARED_WINDOW_DAYS * 864e5);
  const raw = await db.contentFeature.findMany({
    where: { measured: true, publishedAt: { gte: since, lte: new Date(sharedCutoff(now)) }, ...(out.length ? { ownerId: { notIn: out } } : {}) },
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
  const truncated = raw.length >= SHARED_MAX_ROWS;
  const baselines = buildShared(rows, now, { truncated });
  const notes = `Anonymised cohort baselines: ${baselines.buckets.length} buckets from ${baselines.owners} creators' ${baselines.rows} measured posts (last ${baselines.windowDays} days, each past its first week; >= ${baselines.minOwners} creators and ${baselines.minPosts} posts per bucket and per statistic, no creator above half). ${out.length} opted out.${truncated ? ` Row cap of ${SHARED_MAX_ROWS} hit: the window was not read in full.` : ""}`;
  const data = { featureVersion: FEATURE_VERSION, notes, data: JSON.stringify(baselines) };
  let stored: { status: string };
  try {
    stored = await db.modelVersion.upsert({ where: { key: SHARED_MODEL_KEY }, create: { key: SHARED_MODEL_KEY, kind: "shared", status: "active", ...data }, update: data, select: { status: true } });
  } catch {
    // Two rebuilds raced on the first insert: the row exists now, so update it.
    stored = await db.modelVersion.update({ where: { key: SHARED_MODEL_KEY }, data, select: { status: true } });
  }
  cache = { at: Date.now(), value: stored.status === "active" ? baselines : null };
  return { baselines, optedOut: out.length, status: stored.status };
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
  // Newest snapshot per account (distinct on accountId after a day-desc order), not the N newest overall.
  const snaps = await db.accountSnapshot.findMany({ where: { accountId: { in: accounts.map((a) => a.id) }, followers: { not: null } }, orderBy: [{ accountId: "asc" }, { day: "desc" }], distinct: ["accountId"], select: { accountId: true, followers: true } });
  const total = snaps.reduce((s, x) => s + (x.followers ?? 0), 0);
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
  shared: { stored: boolean; builtAt: string | null; rows: number; owners: number; buckets: SharedBucket[]; dropped: number; windowDays: number; minOwners: number; minPosts: number; truncated: boolean } | null;
  /** The stored document's status even when it is not served (retired), or null when none is stored. */
  sharedStatus: string | null;
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
  const now = Date.now();
  // One week more than shown, so the oldest week kept is complete (the first partial week is sliced off).
  const since = new Date(now - (weeks + 1) * 7 * 864e5);
  const [shared, sharedRow, versions, creators, optedOut, measuredOwners, predAll, predEval, evals] = await Promise.all([
    loadShared({ fresh: true }),
    db.modelVersion.findUnique({ where: { key: SHARED_MODEL_KEY }, select: { status: true } }),
    db.modelVersion.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { key: true, kind: true, featureVersion: true, status: true, notes: true, createdAt: true } }),
    db.user.count(),
    db.user.count({ where: { shareLearning: false } }),
    db.contentFeature.findMany({ where: { measured: true }, distinct: ["ownerId"], select: { ownerId: true } }).then((g) => g.length),
    db.predictionRecord.groupBy({ by: ["platform"], where: { modelKey: opts.modelKey }, _count: { _all: true } }),
    db.predictionRecord.groupBy({ by: ["platform"], where: { modelKey: opts.modelKey, evaluatedAt: { not: null } }, _count: { _all: true } }),
    // Evaluated forecasts of the window, filed by the week their outcome was known (not the trailing rollups).
    db.predictionRecord.findMany({ where: { modelKey: opts.modelKey, subjectType: "target", evaluatedAt: { gte: since }, actual: { not: null } }, select: { ownerId: true, platform: true, predicted: true, low: true, high: true, actual: true, evaluatedAt: true }, take: 50_000 }),
  ]);
  const evalBy = new Map(predEval.map((p) => [p.platform, p._count._all]));
  const byPlatform = predAll.map((p) => ({ platform: p.platform, total: p._count._all, evaluated: evalBy.get(p.platform) ?? 0 })).sort((a, b) => b.total - a.total);
  const accuracy = weeklyAccuracy(evals.map((e) => ({ owner: e.ownerId, platform: e.platform, predicted: e.predicted, low: e.low, high: e.high, actual: e.actual as number, evaluatedAt: e.evaluatedAt as Date }))).slice(-weeks);
  return {
    shared: shared ? { stored: true, builtAt: shared.builtAt, rows: shared.rows, owners: shared.owners, buckets: shared.buckets, dropped: shared.dropped, windowDays: shared.windowDays, minOwners: shared.minOwners, minPosts: shared.minPosts, truncated: !!shared.truncated } : null,
    sharedStatus: sharedRow?.status ?? null,
    participation: { creators, optedOut, withMeasuredPosts: measuredOwners },
    versions: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
    predictions: { total: byPlatform.reduce((s, p) => s + p.total, 0), evaluated: byPlatform.reduce((s, p) => s + p.evaluated, 0), byPlatform },
    accuracy,
    drift: driftOf(accuracy),
    modelKey: opts.modelKey,
  };
}

/**
 * The sweep's slot, every tick: rebuild when the stored document is older than SHARED_REBUILD_MS (or missing), so an
 * hourly refresh happens whichever minutes the pinger lands on. One clock, one cheap read otherwise. Never fatal.
 */
export async function sweepShared(now: Date = new Date()): Promise<{ buckets: number; rows: number; status: string } | null> {
  const row = await db.modelVersion.findUnique({ where: { key: SHARED_MODEL_KEY }, select: { data: true } });
  const builtAt = row ? parseShared(row.data)?.builtAt : null;
  if (builtAt && now.getTime() - new Date(builtAt).getTime() < SHARED_REBUILD_MS) return null;
  const { baselines, status } = await rebuildShared({ now });
  return { buckets: baselines.buckets.length, rows: baselines.rows, status };
}
