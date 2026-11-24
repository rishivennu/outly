import "server-only";
import { db } from "../db";
import { logLearning } from "./learning";
import { syncPredictions } from "./model/predict";
import { accountIdsForClient } from "./memory";
import { loadFeatureRows, refreshFeatures, toFeatureRows } from "./features";
import { buildProfile, parseProfile, PROFILE_VERSION, PROFILE_WINDOW_DAYS, weekKey, type CreatorProfileData, type FeatureRow, type Level } from "./profile-core";

/**
 * R1318: creator profiles, the stored side. rebuildProfiles() turns one owner's ContentFeature rows into a workspace
 * profile plus one per platform with posts, writes the week's snapshot once, and logs a LearningEvent. The sweep step
 * (minute % 10 === 2) refreshes features first, then profiles, a few owners a run, oldest profile first.
 */

export const BASELINE_MODEL_KEY = "baseline-ts-1";

export { logLearning } from "./learning";

export interface RebuildResult {
  profiles: number;
  snapshots: number;
  platforms: string[];
}

/**
 * Rebuild the owner's profiles for one scope ("" = workspace; a client key narrows to that client's accounts' posts).
 * A platform with no post in the window loses its row, so the status read never shows a stale platform.
 */
export async function rebuildProfiles(ownerId: string, opts: { scopeKey?: string; now?: Date | number; days?: number } = {}): Promise<RebuildResult> {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const scopeKey = opts.scopeKey ?? "";
  const days = opts.days ?? PROFILE_WINDOW_DAYS;
  let targetIds: string[] | null = null;
  if (scopeKey) {
    const accountIds = await accountIdsForClient(ownerId, scopeKey);
    if (!accountIds) return { profiles: 0, snapshots: 0, platforms: [] };
    const since = new Date(now - days * 864e5);
    const ts = await db.postTarget.findMany({
      where: { post: { userId: ownerId }, socialAccountId: { in: accountIds }, platformStatus: "published", OR: [{ publishedAt: { gte: since } }, { publishedAt: null, post: { publishedAt: { gte: since } } }] },
      select: { id: true },
      orderBy: { publishedAt: "desc" },
      take: 3000,
    });
    targetIds = ts.map((t) => t.id);
  }
  const rows = toFeatureRows(await loadFeatureRows(ownerId, { days, now, targetIds }));
  const platforms = [...new Set(rows.map((r) => r.platform))].sort();
  // A platform that had a profile but no post in the window keeps its row at level "none", so its weekly history stays.
  const idle = (await db.creatorProfile.findMany({ where: { ownerId, scopeKey, platform: { notIn: ["", ...platforms] } }, select: { platform: true } })).map((p) => p.platform);
  const builds: CreatorProfileData[] = [buildProfile(rows, { platform: "", now, days }), ...[...platforms, ...idle].map((p) => buildProfile(rows, { platform: p, now, days }))];
  const week = weekKey(now);
  let snapshots = 0;
  for (const data of builds) {
    const base = { version: PROFILE_VERSION, level: data.level, postsTotal: data.posts.total, postsMeasured: data.posts.measured, data: JSON.stringify(data), computedAt: new Date(now) };
    const row = await db.creatorProfile.upsert({ where: { ownerId_scopeKey_platform: { ownerId, scopeKey, platform: data.platform } }, create: { ownerId, scopeKey, platform: data.platform, ...base }, update: base });
    // One snapshot a week, holding the latest build of that week.
    const existing = await db.creatorProfileSnapshot.findUnique({ where: { profileId_week: { profileId: row.id, week } }, select: { id: true } });
    if (existing) await db.creatorProfileSnapshot.update({ where: { id: existing.id }, data: { level: data.level, data: base.data, at: new Date(now) } });
    else {
      await db.creatorProfileSnapshot.create({ data: { profileId: row.id, week, level: data.level, data: base.data, at: new Date(now) } });
      snapshots++;
    }
  }
  await logLearning(ownerId, "profile_rebuilt", { subjectType: "profile", subjectId: scopeKey || "workspace", dedupeKey: `profile:${scopeKey}:${week}`, data: { platforms, posts: builds[0].posts, level: builds[0].level }, at: new Date(now) });
  return { profiles: builds.length, snapshots, platforms };
}

export interface StoredProfile {
  platform: string;
  level: Level;
  postsTotal: number;
  postsMeasured: number;
  computedAt: string;
  data: CreatorProfileData;
}

/** Every stored profile of the owner in a scope: the workspace one first, then platforms. Another owner's rows never match. */
export async function getProfiles(ownerId: string, scopeKey = ""): Promise<StoredProfile[]> {
  const rows = await db.creatorProfile.findMany({ where: { ownerId, scopeKey }, orderBy: { platform: "asc" } });
  const out: StoredProfile[] = [];
  for (const r of rows) {
    const data = parseProfile(r.data);
    if (!data) continue;
    out.push({ platform: r.platform, level: r.level as Level, postsTotal: r.postsTotal, postsMeasured: r.postsMeasured, computedAt: r.computedAt.toISOString(), data });
  }
  return out.sort((a, b) => (a.platform === "" ? -1 : b.platform === "" ? 1 : a.platform < b.platform ? -1 : 1));
}

export interface PersonalStatus {
  levels: { platform: string; level: Level; postsTotal: number; postsMeasured: number }[];
  featureRows: number;
  measuredRows: number;
  lastComputedAt: string | null;
  lastLearningAt: string | null;
  snapshots: number;
}

/** Levels follow the scope; featureRows, measuredRows and lastLearningAt are workspace-wide (features and the log are kept per owner). */
export async function personalStatus(ownerId: string, scopeKey = ""): Promise<PersonalStatus> {
  const [profiles, featureRows, measuredRows, lastEvent, snapshots] = await Promise.all([
    db.creatorProfile.findMany({ where: { ownerId, scopeKey }, select: { platform: true, level: true, postsTotal: true, postsMeasured: true, computedAt: true }, orderBy: { platform: "asc" } }),
    db.contentFeature.count({ where: { ownerId } }),
    db.contentFeature.count({ where: { ownerId, measured: true } }),
    db.learningEvent.findFirst({ where: { ownerId }, orderBy: { at: "desc" }, select: { at: true } }),
    db.creatorProfileSnapshot.count({ where: { profile: { ownerId, scopeKey } } }),
  ]);
  const last = profiles.reduce<Date | null>((m, p) => (!m || p.computedAt > m ? p.computedAt : m), null);
  return {
    levels: profiles.map((p) => ({ platform: p.platform, level: p.level as Level, postsTotal: p.postsTotal, postsMeasured: p.postsMeasured })),
    featureRows,
    measuredRows,
    lastComputedAt: last ? last.toISOString() : null,
    lastLearningAt: lastEvent ? lastEvent.at.toISOString() : null,
    snapshots,
  };
}

/** Features then profiles for one owner (what POST /api/intelligence/refresh and the sweep both run). */
export async function refreshOwner(ownerId: string, opts: { now?: Date | number; batch?: number; maxBatches?: number } = {}) {
  // Drain the feature backlog in a few batches (a first run can face hundreds of destinations), so the profile below
  // is built on every post the owner has, not the oldest hundred.
  const features = { scanned: 0, written: 0, skipped: 0, remaining: 0 };
  for (let i = 0; i < Math.max(1, opts.maxBatches ?? 5); i++) {
    const r = await refreshFeatures(ownerId, { now: opts.now, batch: opts.batch ?? 200 });
    features.scanned = r.scanned;
    features.written += r.written;
    features.skipped = r.skipped;
    features.remaining = r.remaining;
    if (!r.remaining) break;
  }
  const scopes = await db.brandProfile.findMany({ where: { ownerId, NOT: { scopeKey: "" } }, select: { scopeKey: true }, take: 50 });
  const own = await rebuildProfiles(ownerId, { now: opts.now });
  // R1319: score the newly published destinations from the history before them, fill actuals, roll up accuracy.
  const predictions = await syncPredictions(ownerId, { now: opts.now }).catch((e) => (console.error("[intel] predictions", ownerId, e), null));
  let clients = 0;
  for (const s of scopes) {
    await rebuildProfiles(ownerId, { scopeKey: s.scopeKey, now: opts.now });
    clients++;
  }
  return { features, profiles: own.profiles, clients, predictions };
}

/** A profile is stale after this long; the sweep rebuilds the stalest owners first. */
export const PROFILE_STALE_MS = 6 * 36e5;

/**
 * The sweep step: owners with a live post in the window whose workspace profile is missing or older than
 * PROFILE_STALE_MS, at most `maxOwners` a run. One failing owner never stops the others.
 */
export async function sweepPersonal(opts: { maxOwners?: number; now?: Date | number; ownerIds?: string[] } = {}): Promise<{ owners: number; features: number; failed: number }> {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const maxOwners = Math.max(1, Math.min(20, Math.floor(opts.maxOwners ?? 5) || 5));
  const since = new Date(now - PROFILE_WINDOW_DAYS * 864e5);
  const fresh = new Date(now - PROFILE_STALE_MS);
  // Owners whose workspace profile is fresh are excluded in the query, so the group-by only sees owners that may be
  // due (a distinct over every post would read the whole table every run).
  const freshOwners = (await db.creatorProfile.findMany({ where: { scopeKey: "", platform: "", computedAt: { gte: fresh }, ...(opts.ownerIds ? { ownerId: { in: opts.ownerIds } } : {}) }, select: { ownerId: true }, take: 5000 })).map((p) => p.ownerId);
  const grouped = await db.post.groupBy({
    by: ["userId"],
    where: { publishedAt: { gte: since }, targets: { some: { platformStatus: "published", practice: false } }, userId: { notIn: freshOwners, ...(opts.ownerIds ? { in: opts.ownerIds } : {}) } },
    orderBy: { userId: "asc" },
    take: 200,
  });
  if (!grouped.length) return { owners: 0, features: 0, failed: 0 };
  const ids = grouped.map((c) => c.userId);
  const profiles = await db.creatorProfile.findMany({ where: { ownerId: { in: ids }, scopeKey: "", platform: "" }, select: { ownerId: true, computedAt: true } });
  const at = new Map(profiles.map((p) => [p.ownerId, p.computedAt]));
  const due = ids.sort((a, b) => (at.get(a)?.getTime() ?? 0) - (at.get(b)?.getTime() ?? 0)).slice(0, maxOwners);
  let features = 0;
  let failed = 0;
  for (const ownerId of due) {
    try {
      const r = await refreshOwner(ownerId, { now, batch: 100 });
      features += r.features.written;
    } catch (e) {
      failed++;
      console.error("[sweep] personal", ownerId, e);
    }
  }
  return { owners: due.length, features, failed };
}

/** The deterministic baseline is a model version like any other; created once, idempotent. */
export async function ensureBaselineModel() {
  return db.modelVersion.upsert({ where: { key: BASELINE_MODEL_KEY }, create: { key: BASELINE_MODEL_KEY, kind: "baseline", featureVersion: 1, status: "active", notes: "Deterministic TypeScript baseline: cohort medians, shrinkage, confidence from sample size (R1318)." }, update: {} });
}
