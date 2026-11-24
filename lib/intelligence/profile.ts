import "server-only";
import { db } from "../db";
import { accountIdsForClient } from "./memory";
import { loadFeatureRows, refreshFeatures } from "./features";
import { parseFeatures, parsePerf } from "./features-core";
import { buildProfile, parseProfile, PROFILE_VERSION, PROFILE_WINDOW_DAYS, weekKey, type CreatorProfileData, type FeatureRow, type Level } from "./profile-core";

/**
 * R1318: creator profiles, the stored side. rebuildProfiles() turns one owner's ContentFeature rows into a workspace
 * profile plus one per platform with posts, writes the week's snapshot once, and logs a LearningEvent. The sweep step
 * (minute % 10 === 2) refreshes features first, then profiles, a few owners a run, oldest profile first.
 */

export const BASELINE_MODEL_KEY = "baseline-ts-1";

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** Append to the learning log; the same dedupeKey twice is a no-op (returns false). */
export async function logLearning(ownerId: string, type: string, opts: { subjectType?: string; subjectId?: string; dedupeKey?: string; data?: unknown; at?: Date } = {}): Promise<boolean> {
  try {
    await db.learningEvent.create({
      data: { ownerId, type, subjectType: opts.subjectType ?? null, subjectId: opts.subjectId ?? null, dedupeKey: opts.dedupeKey ?? null, data: opts.data === undefined ? null : JSON.stringify(opts.data).slice(0, 4000), at: opts.at ?? new Date() },
    });
    return true;
  } catch (e) {
    if (isUnique(e)) return false;
    throw e;
  }
}

function rowsOf(raw: Awaited<ReturnType<typeof loadFeatureRows>>): FeatureRow[] {
  const out: FeatureRow[] = [];
  for (const r of raw) {
    const features = parseFeatures(r.features);
    if (!features) continue;
    out.push({ targetId: r.targetId, postId: r.postId, platform: r.platform, format: r.format, publishedAt: r.publishedAt, features, perf: parsePerf(r.perf) });
  }
  return out;
}

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
  let postIds: string[] | null = null;
  if (scopeKey) {
    const accountIds = await accountIdsForClient(ownerId, scopeKey);
    if (!accountIds) return { profiles: 0, snapshots: 0, platforms: [] };
    const ts = await db.postTarget.findMany({ where: { post: { userId: ownerId }, socialAccountId: { in: accountIds } }, select: { postId: true }, take: 3000 });
    postIds = [...new Set(ts.map((t) => t.postId))];
  }
  const rows = rowsOf(await loadFeatureRows(ownerId, { days, now, postIds }));
  const platforms = [...new Set(rows.map((r) => r.platform))].sort();
  const builds: CreatorProfileData[] = [buildProfile(rows, { platform: "", now, days }), ...platforms.map((p) => buildProfile(rows, { platform: p, now, days }))];
  const week = weekKey(now);
  let snapshots = 0;
  for (const data of builds) {
    const base = { version: PROFILE_VERSION, level: data.level, postsTotal: data.posts.total, postsMeasured: data.posts.measured, data: JSON.stringify(data), computedAt: new Date(now) };
    const row = await db.creatorProfile.upsert({ where: { ownerId_scopeKey_platform: { ownerId, scopeKey, platform: data.platform } }, create: { ownerId, scopeKey, platform: data.platform, ...base }, update: base });
    try {
      await db.creatorProfileSnapshot.create({ data: { profileId: row.id, week, level: data.level, data: base.data, at: new Date(now) } });
      snapshots++;
    } catch (e) {
      if (!isUnique(e)) throw e;
    }
  }
  await db.creatorProfile.deleteMany({ where: { ownerId, scopeKey, platform: { notIn: ["", ...platforms] } } });
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
export async function refreshOwner(ownerId: string, opts: { now?: Date | number; batch?: number } = {}) {
  const features = await refreshFeatures(ownerId, { now: opts.now, batch: opts.batch ?? 200 });
  const scopes = await db.brandProfile.findMany({ where: { ownerId, NOT: { scopeKey: "" } }, select: { scopeKey: true }, take: 50 });
  const own = await rebuildProfiles(ownerId, { now: opts.now });
  let clients = 0;
  for (const s of scopes) {
    await rebuildProfiles(ownerId, { scopeKey: s.scopeKey, now: opts.now });
    clients++;
  }
  return { features, profiles: own.profiles, clients };
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
  const candidates = await db.post.findMany({
    where: { publishedAt: { gte: since }, targets: { some: { platformStatus: "published", practice: false } }, ...(opts.ownerIds ? { userId: { in: opts.ownerIds } } : {}) },
    distinct: ["userId"],
    select: { userId: true },
    take: 200,
  });
  if (!candidates.length) return { owners: 0, features: 0, failed: 0 };
  const ids = candidates.map((c) => c.userId);
  const profiles = await db.creatorProfile.findMany({ where: { ownerId: { in: ids }, scopeKey: "", platform: "" }, select: { ownerId: true, computedAt: true } });
  const at = new Map(profiles.map((p) => [p.ownerId, p.computedAt]));
  const due = ids
    .filter((id) => !at.has(id) || at.get(id)! < fresh)
    .sort((a, b) => (at.get(a)?.getTime() ?? 0) - (at.get(b)?.getTime() ?? 0))
    .slice(0, maxOwners);
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
