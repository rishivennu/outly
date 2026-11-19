import "server-only";
import { db } from "../db";
import { METRIC_LABEL, type MetricKey } from "../insights/post-core";
import type { PostRecord } from "./core";
import { computeOutcome, OUTCOME_EVERY_MS, OUTCOME_TRACK_MS, type Outcome } from "./outcome-core";
import { loadPostRecords } from "./service";

/**
 * R1242: the outcomes loop. A recommendation is linked to the post made from it (an 'outcome_link' event, no
 * schema change), and at most once a day that post is compared with its cohort and the result kept as an
 * 'outcome' event. Every read and write checks the owner.
 */

export interface StoredOutcome extends Outcome {
  postId: string;
  measuredAt: string;
}

/** Window of publish dates loaded for the cohort: this many days and the same again before it. */
const COHORT_DAYS = 90;

const parse = <T>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};
const isMetric = (m: unknown): m is MetricKey => typeof m === "string" && Object.prototype.hasOwnProperty.call(METRIC_LABEL, m);

export async function linkOutcome(ownerId: string, recId: string, postId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [rec, post] = await Promise.all([
    db.recommendation.findFirst({ where: { id: recId, ownerId }, select: { id: true } }),
    db.post.findFirst({ where: { id: postId, userId: ownerId }, select: { id: true, variation: { select: { itemId: true } } } }),
  ]);
  if (!rec || !post) return { ok: false, error: "Not found" };
  const last = await db.recommendationEvent.findFirst({ where: { recommendationId: rec.id, type: "outcome_link" }, orderBy: { at: "desc" }, select: { data: true } });
  if (parse<{ postId?: string }>(last?.data ?? null)?.postId !== post.id) {
    await db.recommendationEvent.create({ data: { recommendationId: rec.id, type: "outcome_link", data: JSON.stringify({ postId: post.id }) } });
  }
  if (post.variation?.itemId) await db.recommendation.updateMany({ where: { id: rec.id, ownerId }, data: { contentItemId: post.variation.itemId } });
  return { ok: true };
}

/** The latest link per recommendation, newest links first, only those still tracked. */
async function latestLinks(recIds: string[], now: number): Promise<Map<string, string>> {
  const events = await db.recommendationEvent.findMany({
    where: { recommendationId: { in: recIds }, type: "outcome_link", at: { gte: new Date(now - OUTCOME_TRACK_MS) } },
    orderBy: { at: "desc" },
    select: { recommendationId: true, data: true },
  });
  const out = new Map<string, string>();
  for (const e of events) {
    const postId = parse<{ postId?: string }>(e.data)?.postId;
    if (typeof postId === "string" && !out.has(e.recommendationId)) out.set(e.recommendationId, postId);
  }
  return out;
}

async function freshlyMeasured(recIds: string[], now: number): Promise<Set<string>> {
  if (!recIds.length) return new Set();
  const rows = await db.recommendationEvent.findMany({
    where: { recommendationId: { in: recIds }, type: "outcome", at: { gt: new Date(now - OUTCOME_EVERY_MS) } },
    select: { recommendationId: true },
  });
  return new Set(rows.map((r) => r.recommendationId));
}

/** Measures linked recommendations that have no outcome from the last 24 hours. Safe to call as often as you like. */
export async function measureOutcomes(ownerId: string, opts: { limit?: number; now?: Date | number } = {}): Promise<{ measured: number }> {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
  const recs = await db.recommendation.findMany({ where: { ownerId }, select: { id: true, platform: true, evidence: true } });
  if (!recs.length) return { measured: 0 };
  const links = await latestLinks(recs.map((r) => r.id), now);
  const fresh = await freshlyMeasured([...links.keys()], now);
  const due = recs.filter((r) => links.has(r.id) && !fresh.has(r.id)).slice(0, limit);
  if (!due.length) return { measured: 0 };
  const postIds = [...new Set(due.map((r) => links.get(r.id)!))];
  const [targets, records] = await Promise.all([
    db.postTarget.findMany({ where: { postId: { in: postIds }, post: { userId: ownerId } }, select: { id: true, postId: true } }),
    loadPostRecords({ id: ownerId, scope: null }, { days: COHORT_DAYS, accountIds: null }),
  ]);
  const byId = new Map(records.map((r) => [r.id, r]));
  let measured = 0;
  for (const rec of due) {
    const postId = links.get(rec.id)!;
    const own = targets.filter((t) => t.postId === postId).map((t) => t.id);
    const mine = own.map((id) => byId.get(id)).filter((r): r is PostRecord => !!r);
    // A post on several platforms: the destination the recommendation was about.
    const post = mine.find((r) => r.platform === rec.platform) ?? mine[0] ?? null;
    const ev = parse<{ metric?: unknown }>(rec.evidence);
    const metric: MetricKey = isMetric(ev?.metric) ? ev.metric : "engagementRate";
    const cohort = records.filter((r) => !own.includes(r.id));
    const outcome = computeOutcome(post, cohort, metric, now);
    const data: StoredOutcome = { ...outcome, postId, measuredAt: new Date(now).toISOString() };
    await db.recommendationEvent.create({ data: { recommendationId: rec.id, type: "outcome", data: JSON.stringify(data), at: new Date(now) } });
    measured++;
  }
  return { measured };
}

/** The latest outcome of each of these recommendations, for the dashboard. Ids of other owners are ignored. */
export async function outcomesFor(ownerId: string, recIds: string[]): Promise<Record<string, StoredOutcome>> {
  const ids = [...new Set(recIds)].slice(0, 100);
  if (!ids.length) return {};
  const owned = await db.recommendation.findMany({ where: { ownerId, id: { in: ids } }, select: { id: true } });
  if (!owned.length) return {};
  const rows = await db.recommendationEvent.findMany({
    where: { recommendationId: { in: owned.map((r) => r.id) }, type: "outcome" },
    orderBy: { at: "desc" },
    select: { recommendationId: true, data: true },
  });
  const out: Record<string, StoredOutcome> = {};
  for (const r of rows) {
    if (out[r.recommendationId]) continue;
    const o = parse<StoredOutcome>(r.data);
    if (o) out[r.recommendationId] = o;
  }
  return out;
}

/**
 * The /api/cron/sweep step: owners with a tracked link that has no outcome from the last 24 hours, at most
 * `maxOwners` per run, each in its own try so one bad owner never stops the rest.
 */
export async function sweepOutcomes(opts: { maxOwners?: number; now?: Date | number } = {}): Promise<{ owners: number; measured: number; failed: number }> {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const maxOwners = Math.max(1, Math.min(50, opts.maxOwners ?? 10));
  const links = await db.recommendationEvent.findMany({
    where: { type: "outcome_link", at: { gte: new Date(now - OUTCOME_TRACK_MS) } },
    orderBy: { at: "desc" },
    take: 500,
    select: { recommendationId: true },
  });
  const linked = [...new Set(links.map((l) => l.recommendationId))];
  const fresh = await freshlyMeasured(linked, now);
  const pending = linked.filter((id) => !fresh.has(id));
  if (!pending.length) return { owners: 0, measured: 0, failed: 0 };
  const recs = await db.recommendation.findMany({ where: { id: { in: pending } }, select: { ownerId: true } });
  const owners = [...new Set(recs.map((r) => r.ownerId))].slice(0, maxOwners);
  let measured = 0;
  let failed = 0;
  for (const ownerId of owners) {
    try {
      measured += (await measureOutcomes(ownerId, { now })).measured;
    } catch (e) {
      failed++;
      console.error("[sweep] outcomes", ownerId, e);
    }
  }
  return { owners: owners.length, measured, failed };
}
