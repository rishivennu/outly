/**
 * R1319: the prediction engine, deterministic baseline. Pure: a creator's measured history and the features of the
 * post to score in, one Prediction out (or null when there is nothing honest to say).
 *
 * How baseline-ts-1 scores views:
 *  1. cohort = the creator's measured posts of the same platform and format, published before the moment scored;
 *  2. the cohort median is shrunk toward a prior (the shared baseline when one exists, else the creator's platform-wide
 *     median) with weight n / (n + SHRINK_K), so three posts never pretend to be thirty;
 *  3. trait lifts measured on that cohort (lib/intelligence/profile-core.ts) adjust the estimate, each capped and
 *     damped by the same weight, the product clamped to [MIN_ADJ, MAX_ADJ];
 *  4. the range follows the cohort's own spread (p25 / p75 around its median), never a fixed percentage dressed up.
 *
 * The level is the honesty ladder of profile-core.ts; at "none" there is no number at all. A Python / CatBoost scorer
 * (master prompt §9) plugs in behind the same Scorer interface when a host for it exists; it must return this shape.
 */

import { median } from "../../live/suggest";
import type { MetricKey } from "../../insights/post-core";
import type { ContentFeatures } from "../features-core";
import { levelOf, traitLifts, type FeatureRow, type Level, type Lift } from "../profile-core";
import { confidenceOf, type Confidence } from "../core";

export const BASELINE_KEY = "baseline-ts-1";
export const SHRINK_K = 6;
export const LIFT_CAP_PCT = 50;
export const MIN_ADJ = 0.5;
export const MAX_ADJ = 1.5;
/** A prediction is evaluated once the post is at least this old (its first week is in). */
export const EVAL_MIN_AGE_DAYS = 7;
/** A neighbour only counts once its own first week is over: what it did before that is not known as of `asOf`. */
export const COHORT_LAG_MS = EVAL_MIN_AGE_DAYS * 864e5;

export interface SharedBaseline {
  /** Where the prior came from, for the explanation. */
  source: string;
  median: number;
  n: number;
}

export interface ScoreInput {
  platform: string;
  format: string;
  /** What is known of the post; a draft may have only some fields. */
  features: Partial<ContentFeatures>;
  /** The creator's history, measured rows only are used; rows at or after `asOf` are ignored (no leakage). */
  history: FeatureRow[];
  asOf: Date | number;
  shared?: SharedBaseline | null;
  metric?: MetricKey;
}

export interface Adjustment {
  trait: string;
  label: string;
  /** The post has the trait (true) or lacks it (false). */
  has: boolean;
  liftPct: number;
  factor: number;
}

export interface PredictionBasis {
  cohortN: number;
  cohortMedian: number | null;
  cohortP25: number | null;
  cohortP75: number | null;
  platformN: number;
  platformMedian: number | null;
  prior: { source: string; value: number } | null;
  shrinkWeight: number;
  adjustments: Adjustment[];
  adjustment: number;
}

export interface Prediction {
  modelKey: string;
  metric: MetricKey;
  platform: string;
  format: string;
  level: Exclude<Level, "none">;
  confidence: Confidence;
  n: number;
  predicted: number;
  low: number;
  high: number;
  basis: PredictionBasis;
  explanation: string;
}

export interface Scorer {
  key: string;
  score(input: ScoreInput): Prediction | null;
}

const time = (d: string | Date | number) => (d instanceof Date ? d.getTime() : typeof d === "number" ? d : Date.parse(d));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** How many measured posts of this platform + format the creator has before `asOf` (the scorer's own cohort size). */
export function cohortSize(history: readonly FeatureRow[], platform: string, format: string, asOf: Date | number, metric: MetricKey = "views"): number {
  const at = time(asOf);
  return history.filter((r) => r.platform === platform && r.format === format && time(r.publishedAt) <= at - COHORT_LAG_MS && valueOf(r, metric) !== null).length;
}

function valueOf(row: FeatureRow, metric: MetricKey): number | null {
  if (!row.perf?.measured) return null;
  if (metric === "engagementRate") return row.perf.engagementRate;
  const v = row.perf.totals[metric];
  return typeof v === "number" ? v : null;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Does this post have the trait a lift talks about? null when the feature needed is not known yet (a thin draft). */
export function traitOf(trait: string, f: Partial<ContentFeatures>): boolean | null {
  switch (trait) {
    case "hasHook":
    case "hasQuestion":
    case "hasCta":
    case "hasCover":
    case "hasFirstComment": {
      const v = f[trait];
      return typeof v === "boolean" ? v : null;
    }
    case "longCaption":
      return typeof f.captionLen === "number" ? f.captionLen > 150 : null;
    case "manyTags":
      return typeof f.hashtagCount === "number" ? f.hashtagCount >= 5 : null;
    case "weekend":
      return typeof f.weekday === "number" ? f.weekday === 0 || f.weekday === 6 : null;
    case "shortVideo":
      return f.format === "video" && typeof f.durationSec === "number" ? f.durationSec < 30 : null;
    default:
      return null;
  }
}

/** Each lift becomes a factor: having a trait that lifts the median moves the estimate up, lacking it moves it down; capped and damped. */
export function adjustmentsFor(lifts: Lift[], f: Partial<ContentFeatures>, weight: number): Adjustment[] {
  const out: Adjustment[] = [];
  for (const l of lifts) {
    const has = traitOf(l.trait, f);
    if (has === null) continue;
    const capped = Math.max(-LIFT_CAP_PCT, Math.min(LIFT_CAP_PCT, l.liftPct)) / 100;
    // With the trait: the "with" side vs the overall; without: the "without" side. Both relative to the cohort median
    // the estimate starts from, approximated as half the gap each way.
    const factor = r2(1 + (has ? capped : -capped) * 0.5 * weight);
    out.push({ trait: l.trait, label: l.label, has, liftPct: l.liftPct, factor });
  }
  return out;
}

export const baselineScorer: Scorer = {
  key: BASELINE_KEY,
  score(input) {
    const metric = input.metric ?? "views";
    const asOf = time(input.asOf);
    // No leakage: a post published after asOf, or so close before it that its numbers were not in yet, is not a neighbour.
    const before = input.history.filter((r) => time(r.publishedAt) <= asOf - COHORT_LAG_MS && r.platform === input.platform);
    const platformVals = before.map((r) => valueOf(r, metric)).filter((v): v is number => typeof v === "number");
    const cohortRows = before.filter((r) => r.format === input.format && valueOf(r, metric) !== null);
    const cohortVals = cohortRows.map((r) => valueOf(r, metric) as number).sort((a, b) => a - b);
    const n = cohortVals.length;
    const level = levelOf(n);
    const cohortMedian = n ? median(cohortVals) : null;
    const platformMedian = platformVals.length ? median(platformVals) : null;
    const prior = input.shared ? { source: input.shared.source, value: input.shared.median } : platformMedian !== null && platformVals.length > n ? { source: "your other formats on this platform", value: platformMedian } : null;
    // Nothing measured at all for this creator here, and no shared prior: no number.
    if (level === "none" && !prior) return null;
    const weight = r2(n / (n + SHRINK_K));
    const start = cohortMedian ?? prior!.value;
    const centre = prior ? weight * start + (1 - weight) * prior.value : start;
    const adjustments = n ? adjustmentsFor(traitLifts(cohortRows, metric), input.features, weight) : [];
    const adjustment = r2(Math.max(MIN_ADJ, Math.min(MAX_ADJ, adjustments.reduce((p, a) => p * a.factor, 1))));
    const predicted = centre * adjustment;
    const p25 = n >= 3 ? quantile(cohortVals, 0.25) : null;
    const p75 = n >= 3 ? quantile(cohortVals, 0.75) : null;
    // The spread of the cohort around its median, applied to the estimate; with under 3 posts a wide default band.
    const lowRatio = cohortMedian && p25 !== null && cohortMedian > 0 ? Math.min(1, p25 / cohortMedian) : 0.5;
    const highRatio = cohortMedian && p75 !== null && cohortMedian > 0 ? Math.max(1, p75 / cohortMedian) : 1.8;
    const round = (v: number) => (metric === "engagementRate" ? r2(v) : Math.round(v));
    const lvl: Exclude<Level, "none"> = level === "none" ? "general" : level;
    const basis: PredictionBasis = { cohortN: n, cohortMedian: cohortMedian === null ? null : r2(cohortMedian), cohortP25: p25 === null ? null : r2(p25), cohortP75: p75 === null ? null : r2(p75), platformN: platformVals.length, platformMedian: platformMedian === null ? null : r2(platformMedian), prior, shrinkWeight: weight, adjustments, adjustment };
    return {
      modelKey: BASELINE_KEY,
      metric,
      platform: input.platform,
      format: input.format,
      level: lvl,
      confidence: confidenceOf(n),
      n,
      predicted: round(predicted),
      low: round(predicted * lowRatio),
      high: round(predicted * highRatio),
      basis,
      explanation: explain(lvl, n, prior, adjustments, input.format, input.platform),
    };
  },
};

function explain(level: Exclude<Level, "none">, n: number, prior: { source: string } | null, adj: Adjustment[], format: string, platform: string): string {
  const base = n ? `the median of your last ${n} measured ${format} post${n === 1 ? "" : "s"} on ${platform}` : `${prior?.source ?? "general guidance"} (no measured ${format} post of yours on ${platform} yet)`;
  const lean = level === "personal" ? "Mostly your own numbers" : level === "blended" ? "Your numbers, pulled toward the baseline" : "General guidance only";
  const notes = adj.filter((a) => a.factor !== 1).slice(0, 3).map((a) => `${a.has ? "has" : "lacks"} ${a.label} (${a.has ? (a.liftPct > 0 ? "+" : "") : a.liftPct > 0 ? "-" : "+"}${Math.abs(Math.round(Math.max(-LIFT_CAP_PCT, Math.min(LIFT_CAP_PCT, a.liftPct)) * 0.5))}%)`);
  return `${lean}: ${base}${notes.length ? `; adjusted because it ${notes.join(", ")}` : ""}. An estimate from past posts, not a promise.`;
}

/* ------------------------------------------------------------------ evaluation */

export interface EvaluatedRecord {
  predicted: number;
  low: number;
  high: number;
  actual: number;
}

export interface Evaluation {
  n: number;
  /** Median absolute percentage error, 0..; null under 1 record. */
  medianApe: number | null;
  mape: number | null;
  /** Share of actuals inside [low, high], 0..100. */
  within: number | null;
  /** Median signed error in percent: positive means the model over-predicts. */
  biasPct: number | null;
}

export const apeOf = (predicted: number, actual: number) => (actual > 0 ? (Math.abs(predicted - actual) / actual) * 100 : predicted === 0 ? 0 : 100);

export function evaluate(records: EvaluatedRecord[]): Evaluation {
  const rows = records.filter((r) => Number.isFinite(r.predicted) && Number.isFinite(r.actual));
  if (!rows.length) return { n: 0, medianApe: null, mape: null, within: null, biasPct: null };
  const apes = rows.map((r) => apeOf(r.predicted, r.actual));
  const signed = rows.map((r) => (r.actual > 0 ? ((r.predicted - r.actual) / r.actual) * 100 : r.predicted === 0 ? 0 : 100));
  const inside = rows.filter((r) => r.actual >= r.low && r.actual <= r.high).length;
  return { n: rows.length, medianApe: r2(median(apes)), mape: r2(apes.reduce((a, b) => a + b, 0) / apes.length), within: Math.round((inside / rows.length) * 100), biasPct: r2(median(signed)) };
}

/** Plain words for an evaluation, never a grade the data cannot carry. */
export function accuracyWords(e: Evaluation | null): string {
  if (!e || !e.n) return "No scored post has finished its first week yet, so accuracy cannot be judged.";
  if (e.n < 5) return `Judged on ${e.n} post${e.n === 1 ? "" : "s"} so far: too few to trust; typical error ${e.medianApe}%.`;
  return `Over ${e.n} posts the typical error was ${e.medianApe}%, ${e.within}% of actuals fell inside the range${e.biasPct !== null && Math.abs(e.biasPct) >= 10 ? `, and it tends to ${e.biasPct > 0 ? "over" : "under"}-estimate` : ""}.`;
}

export function parseBasis(raw: string | null | undefined): PredictionBasis | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as PredictionBasis;
    return v && typeof v === "object" && typeof v.cohortN === "number" ? v : null;
  } catch {
    return null;
  }
}
