import "server-only";
import { db } from "../../db";
import { loadFeatureRows, toFeatureRows } from "../features";
import { extractFeatures, type ContentFeatures } from "../features-core";
import { logLearning } from "../learning";
import { PERSONAL_MIN, PROFILE_WINDOW_DAYS, traitLifts, levelOf, weekKey, type FeatureRow, type Level, type Lift } from "../profile-core";
import type { PostRecord } from "../core";
import { followersOn, loadShared } from "../shared";
import { sharedFor } from "../shared-core";
import { accuracyWords, apeOf, baselineScorer, BASELINE_KEY, EVAL_MIN_AGE_DAYS, evaluate, parseBasis, type Evaluation, type Prediction, type Scorer, type SharedBaseline } from "./scorer-core";

/**
 * R1319: predictions, the stored side. Every published destination is scored once from the creator's history before
 * its publish time (so the record is a real forecast), filled with the actual after the first week, and rolled up
 * into a weekly accuracy row per platform. Drafts are scored on request and stored only when they name a post.
 * Everything is scoped by ownerId; the scorer is swappable (SCORERS) and every row names its model.
 */

export const SCORERS: Record<string, Scorer> = { [BASELINE_KEY]: baselineScorer };
export const ACTIVE_MODEL = BASELINE_KEY;
export const HISTORY_DAYS = 180;
const METRIC = "views" as const;

async function history(ownerId: string, now: number, targetIds?: string[] | null): Promise<FeatureRow[]> {
  return toFeatureRows(await loadFeatureRows(ownerId, { days: HISTORY_DAYS, now, targetIds }));
}

/** A shared prior for one question, or null. `measured` is the creator's measured posts on that platform (every format). */
export type SharedLookup = (q: { platform: string; format: string; categories?: readonly string[]; measured: number }) => SharedBaseline | null;

/** The creator's measured posts on a platform, the count the personal level is read from. */
export const measuredOn = (rows: readonly FeatureRow[], platform: string) => rows.filter((r) => r.platform === platform && r.perf?.measured).length;

/**
 * R1324: the shared prior, offered only below the personal level on that platform (PERSONAL_MIN measured posts across
 * its formats: a creator with a deep platform history keeps their own platform-wide prior for a new format), scaled to
 * the creator's follower count. Live estimates only: backfilled forecasts (syncPredictions) stay own-data, so an
 * evaluation never benefits from a cohort document built after the post went out.
 */
export async function sharedLookupFor(ownerId: string, platforms: readonly string[]): Promise<SharedLookup> {
  const b = await loadShared().catch(() => null);
  if (!b || !b.buckets.length) return () => null;
  const wanted = [...new Set(platforms)];
  const followers = new Map(await Promise.all(wanted.map(async (p) => [p, await followersOn(ownerId, p).catch(() => null)] as const)));
  return (q) => (q.measured >= PERSONAL_MIN ? null : sharedFor(b, { platform: q.platform, format: q.format, categories: q.categories, followers: followers.get(q.platform) ?? null }));
}

export interface DraftInput {
  platform: string;
  format: string;
  title?: string | null;
  caption?: string | null;
  hashtags?: string | null;
  hook?: string | null;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  scheduledAt?: string | Date | null;
  timezone?: string | null;
  /** When set, the prediction is stored against this post (owner-checked) so it can be evaluated later. */
  postId?: string | null;
}

/** Score a draft from the creator's history. Returns null when there is nothing honest to say (level none, no prior). */
export async function predictDraft(ownerId: string, draft: DraftInput, opts: { now?: Date | number; scopeKey?: string } = {}): Promise<Prediction | null> {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const at = draft.scheduledAt ? new Date(draft.scheduledAt) : new Date(now);
  const user = draft.timezone === undefined ? await db.user.findUnique({ where: { id: ownerId }, select: { timezone: true } }) : null;
  const record: PostRecord = { id: "draft", platform: draft.platform, format: draft.format, publishedAt: at.toISOString(), metrics: {} };
  const features = extractFeatures({ record, title: draft.title, caption: draft.caption, hashtags: draft.hashtags, hook: draft.hook, media: { duration: draft.durationSec, width: draft.width, height: draft.height }, timezone: draft.timezone ?? user?.timezone });
  // A draft's gap, cross-posting and cover are unknown: scored as not known, not as absent.
  const known: Partial<ContentFeatures> = { ...features };
  delete known.hasCover;
  delete known.hasFirstComment;
  delete known.gapDays;
  delete known.crossPosted;
  const rows = await history(ownerId, now);
  const shared = await sharedLookupFor(ownerId, [draft.platform]);
  const prediction = SCORERS[ACTIVE_MODEL].score({ platform: draft.platform, format: draft.format, features: known, history: rows, asOf: now, shared: shared({ platform: draft.platform, format: draft.format, categories: known.categories, measured: measuredOn(rows, draft.platform) }) });
  if (prediction && draft.postId) {
    // Stored only while the post is still ahead of its outcome (a draft or a scheduled post), and never over a
    // forecast that has already been judged: a number written after the fact would be hindsight, not a forecast.
    const post = await db.post.findFirst({ where: { id: draft.postId, userId: ownerId, status: { in: ["draft", "scheduled"] } }, select: { id: true } });
    if (post) await storePrediction(ownerId, opts.scopeKey ?? "", "post", post.id, prediction, now);
  }
  return prediction;
}

async function storePrediction(ownerId: string, scopeKey: string, subjectType: string, subjectId: string, p: Prediction, now: number) {
  const data = { platform: p.platform, format: p.format, level: p.level, predicted: p.predicted, low: p.low, high: p.high, basis: JSON.stringify(p.basis) };
  if (subjectType === "post") {
    const judged = await db.predictionRecord.findFirst({ where: { ownerId, modelKey: p.modelKey, subjectType, subjectId, metric: p.metric, actual: { not: null } }, select: { id: true } });
    if (judged) return null;
  }
  return db.predictionRecord.upsert({
    where: { ownerId_modelKey_subjectType_subjectId_metric: { ownerId, modelKey: p.modelKey, subjectType, subjectId, metric: p.metric } },
    create: { ownerId, scopeKey, modelKey: p.modelKey, subjectType, subjectId, metric: p.metric, ...data, createdAt: new Date(now) },
    update: data,
  });
}

export interface SyncResult {
  scored: number;
  skipped: number;
  evaluated: number;
  platforms: number;
}

/**
 * The owner's loop: score destinations that have a feature row but no forecast yet (history strictly before their
 * publish time), fill actuals for forecasts whose post is a week old and measured, roll up this week's accuracy, and
 * refresh the per-platform calibration. Bounded and idempotent.
 */
export async function syncPredictions(ownerId: string, opts: { now?: Date | number; batch?: number } = {}): Promise<SyncResult> {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const batch = Math.max(1, Math.min(200, opts.batch ?? 50));
  const rows = await history(ownerId, now);
  const scorer = SCORERS[ACTIVE_MODEL];
  const targetIds = rows.map((r) => r.targetId);
  const have = new Set((await db.predictionRecord.findMany({ where: { ownerId, modelKey: scorer.key, subjectType: "target", metric: METRIC, subjectId: { in: targetIds } }, select: { subjectId: true } })).map((r) => r.subjectId));
  // Newest first; a row that scores null (a platform never measured, the first post somewhere) is skipped every time,
  // so the walk goes past it instead of stopping at `batch` rows looked at. Attempts are bounded all the same.
  const pending = rows.filter((r) => !have.has(r.targetId)).sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  let scored = 0;
  let skipped = 0;
  for (const row of pending) {
    if (scored >= batch || scored + skipped >= batch * 4) break;
    const p = scorer.score({ platform: row.platform, format: row.format, features: row.features, history: rows, asOf: new Date(row.publishedAt), metric: METRIC });
    if (!p) {
      skipped++;
      continue;
    }
    await storePrediction(ownerId, "", "target", row.targetId, p, now);
    scored++;
  }
  // Actuals: forecasts without one whose destination is measured and past its first week. Bounded to the targets in
  // the history: one whose target left it (removed, or older than HISTORY_DAYS) is never judged, and never re-read.
  const byTarget = new Map(rows.map((r) => [r.targetId, r]));
  const open = await db.predictionRecord.findMany({ where: { ownerId, modelKey: scorer.key, subjectType: "target", actual: null, subjectId: { in: targetIds } }, select: { id: true, subjectId: true, predicted: true } });
  // Draft forecasts (predictDraft with a postId) are judged from the post's destination on the same platform. A post
  // with two destinations on one platform (two accounts) is judged by the later row; rows are in time order.
  const byPost = new Map(rows.map((r) => [`${r.postId}|${r.platform}`, r]));
  const openDrafts = await db.predictionRecord.findMany({ where: { ownerId, modelKey: scorer.key, subjectType: "post", actual: null, subjectId: { in: [...new Set(rows.map((r) => r.postId))] } }, select: { id: true, subjectId: true, predicted: true, platform: true } });
  let evaluated = 0;
  const judge = async (rec: { id: string; subjectId: string; predicted: number }, subjectType: string, row: FeatureRow | undefined) => {
    const actual = row?.perf?.measured && row.perf.ageDays >= EVAL_MIN_AGE_DAYS ? row.perf.totals[METRIC] : undefined;
    if (typeof actual !== "number") return;
    await db.predictionRecord.update({ where: { id: rec.id }, data: { actual, errorPct: Math.round(apeOf(rec.predicted, actual) * 100) / 100, evaluatedAt: new Date(now) } });
    await logLearning(ownerId, "prediction_evaluated", { subjectType, subjectId: rec.subjectId, dedupeKey: `eval:${rec.id}`, data: { predicted: rec.predicted, actual }, at: new Date(now) });
    evaluated++;
  };
  for (const rec of open) await judge(rec, "target", byTarget.get(rec.subjectId));
  for (const rec of openDrafts) await judge(rec, "post", byPost.get(`${rec.subjectId}|${rec.platform}`));
  const platforms = await rollup(ownerId, scorer.key, now);
  await calibrate(ownerId, "", rows, now);
  return { scored, skipped, evaluated, platforms };
}

/** This week's accuracy row per platform (and "" for all), over the evaluated forecasts of the last 90 days. */
async function rollup(ownerId: string, modelKey: string, now: number): Promise<number> {
  const since = new Date(now - PROFILE_WINDOW_DAYS * 864e5);
  const done = await db.predictionRecord.findMany({ where: { ownerId, modelKey, subjectType: "target", evaluatedAt: { not: null }, createdAt: { gte: since } }, select: { platform: true, predicted: true, low: true, high: true, actual: true } });
  if (!done.length) return 0;
  const groups = new Map<string, typeof done>();
  groups.set("", done);
  for (const d of done) (groups.get(d.platform) ?? groups.set(d.platform, []).get(d.platform)!).push(d);
  const week = weekKey(now);
  for (const [platform, list] of groups) {
    const e = evaluate(list.map((d) => ({ predicted: d.predicted, low: d.low, high: d.high, actual: d.actual as number })));
    const data = { n: e.n, medianApe: e.medianApe, mape: e.mape, within: e.within, biasPct: e.biasPct, data: JSON.stringify(e), at: new Date(now) };
    await db.intelligenceEvaluation.upsert({ where: { ownerId_modelKey_platform_week: { ownerId, modelKey, platform, week } }, create: { ownerId, modelKey, platform, week, ...data }, update: data });
  }
  return groups.size - 1;
}

export interface FormatBaseline {
  format: string;
  n: number;
  level: Exclude<Level, "none">;
  predicted: number;
  low: number;
  high: number;
  confidence: Prediction["confidence"];
  explanation: string;
  /** When the number leans on the shared cohort: how many posts and creators it came from. */
  prior?: { shared: boolean; n: number; owners: number | null } | null;
}

export interface ModelState {
  modelKey: string;
  platform: string;
  level: Level;
  measured: number;
  byFormat: FormatBaseline[];
  lifts: Lift[];
  computedAt: string;
  /** True when any format here leaned on the shared cohort document at the time it was computed. */
  shared?: boolean;
}

/** What a typical post of each format would do today, per platform, from the rows given. Pure apart from the clock. */
export function statesFrom(rows: FeatureRow[], now: number, shared: SharedLookup = () => null): ModelState[] {
  const scorer = SCORERS[ACTIVE_MODEL];
  const platforms = [...new Set(rows.map((r) => r.platform))].sort();
  return platforms.map((platform) => {
    const mine = rows.filter((r) => r.platform === platform);
    const measured = mine.filter((r) => r.perf?.measured).length;
    const formats = [...new Set(mine.map((r) => r.format))].sort();
    const byFormat: FormatBaseline[] = [];
    for (const format of formats) {
      const p = scorer.score({ platform, format, features: {}, history: rows, asOf: now, metric: METRIC, shared: shared({ platform, format, measured }) });
      if (p) byFormat.push({ format, n: p.n, level: p.level, predicted: p.predicted, low: p.low, high: p.high, confidence: p.confidence, explanation: p.explanation, prior: p.basis.prior?.shared ? { shared: true, n: p.basis.prior.n ?? 0, owners: p.basis.prior.owners ?? null } : null });
    }
    const usedShared = byFormat.some((f) => f.prior?.shared);
    return { modelKey: scorer.key, platform, level: levelOf(measured), measured, byFormat, lifts: traitLifts(mine, METRIC), computedAt: new Date(now).toISOString(), ...(usedShared ? { shared: true } : {}) };
  });
}

async function calibrate(ownerId: string, scopeKey: string, rows: FeatureRow[], now: number) {
  const states = statesFrom(rows, now, await sharedLookupFor(ownerId, rows.map((r) => r.platform)));
  for (const s of states) {
    await db.creatorModelState.upsert({ where: { ownerId_scopeKey_modelKey_platform: { ownerId, scopeKey, modelKey: s.modelKey, platform: s.platform } }, create: { ownerId, scopeKey, modelKey: s.modelKey, platform: s.platform, state: JSON.stringify(s) }, update: { state: JSON.stringify(s) } });
  }
  await db.creatorModelState.deleteMany({ where: { ownerId, scopeKey, modelKey: ACTIVE_MODEL, platform: { notIn: states.map((s) => s.platform) } } });
  return states;
}

/**
 * The creator's per-platform states: the stored calibration for the workspace scope, or computed on the spot over a
 * client's destinations (a client scope has no stored state of its own).
 */
export async function modelStates(ownerId: string, opts: { scopeKey?: string; targetIds?: string[] | null; now?: number } = {}): Promise<ModelState[]> {
  const now = opts.now ?? Date.now();
  const live = async (rows: FeatureRow[]) => statesFrom(rows, now, await sharedLookupFor(ownerId, rows.map((r) => r.platform)));
  if (opts.scopeKey) return live(await history(ownerId, now, opts.targetIds ?? []));
  const stored = await db.creatorModelState.findMany({ where: { ownerId, scopeKey: "", modelKey: ACTIVE_MODEL }, orderBy: { platform: "asc" }, take: 20 });
  // Before the first calibration (the sweep has not reached this owner yet) the states are computed on the spot.
  if (!stored.length) return live(await history(ownerId, now));
  const states = stored.map((s) => JSON.parse(s.state) as ModelState);
  // A stored state that leaned on the shared document is served only while that document is still active; once an
  // admin retires it the state is recomputed from the creator's own rows (and the stored copy refreshed).
  if (states.some((s) => s.shared) && !(await loadShared().catch(() => null))) return calibrate(ownerId, "", await history(ownerId, now), now);
  return states;
}

export interface PlatformPredictions extends ModelState {
  accuracy: Evaluation | null;
  accuracyWords: string;
}

export interface PredictionsOverview {
  model: { key: string; kind: string; status: string } | null;
  platforms: PlatformPredictions[];
  overall: { accuracy: Evaluation | null; words: string };
  recent: { subjectId: string; platform: string; format: string; predicted: number; low: number; high: number; actual: number | null; errorPct: number | null; level: string; createdAt: string }[];
}

/**
 * The read model behind GET /api/intelligence/predictions. The workspace scope reads the stored states; a client scope
 * is computed live from the client's destinations (states are stored per workspace only).
 */
export async function predictionsOverview(ownerId: string, opts: { scopeKey?: string; targetIds?: string[] | null; platform?: string | null; now?: Date | number } = {}): Promise<PredictionsOverview> {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const scopeKey = opts.scopeKey ?? "";
  const [model, evals, recentRows] = await Promise.all([
    db.modelVersion.findUnique({ where: { key: ACTIVE_MODEL }, select: { key: true, kind: true, status: true } }),
    db.intelligenceEvaluation.findMany({ where: { ownerId, modelKey: ACTIVE_MODEL }, orderBy: { at: "desc" }, take: 40 }),
    // A client scope only sees forecasts for its own destinations.
    db.predictionRecord.findMany({ where: { ownerId, modelKey: ACTIVE_MODEL, subjectType: "target", ...(opts.platform ? { platform: opts.platform } : {}), ...(scopeKey ? { subjectId: { in: opts.targetIds ?? [] } } : {}) }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  let states = await modelStates(ownerId, { scopeKey, targetIds: opts.targetIds, now });
  if (opts.platform) states = states.filter((s) => s.platform === opts.platform);
  // Accuracy is measured over the whole workspace; inside a client scope it is not shown rather than shown wrong.
  const latest = new Map<string, Evaluation>();
  if (!scopeKey) for (const e of evals) if (!latest.has(e.platform)) latest.set(e.platform, { n: e.n, medianApe: e.medianApe, mape: e.mape, within: e.within, biasPct: e.biasPct });
  const overall = latest.get("") ?? null;
  return {
    model,
    platforms: states.map((s) => ({ ...s, accuracy: latest.get(s.platform) ?? null, accuracyWords: accuracyWords(latest.get(s.platform) ?? null) })),
    overall: { accuracy: overall, words: accuracyWords(overall) },
    recent: recentRows.map((r) => ({ subjectId: r.subjectId, platform: r.platform, format: r.format, predicted: r.predicted, low: r.low, high: r.high, actual: r.actual, errorPct: r.errorPct, level: r.level, createdAt: r.createdAt.toISOString() })),
  };
}

export { parseBasis };
