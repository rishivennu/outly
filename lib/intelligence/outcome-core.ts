import { PLATFORM_META, type Platform } from "../domain";
import { FORMAT_LABEL, POST_FORMATS, type PostFormat } from "../formats";
import { formatMetric, METRIC_LABEL, type MetricKey } from "../insights/post-core";
import { median } from "../live/suggest";
import { confidenceOf, metricValue, MIN_SAMPLE, SIGNAL_MIN_LIFT, type Confidence, type PostRecord } from "./core";

/**
 * R1242: how the post made from an accepted recommendation did against its own cohort (the owner's other posts of
 * the same platform and format). One post proves nothing, so the verdict is only ever an early signal and the
 * wording never says the recommendation caused it.
 */

/** A post younger than this has numbers still climbing: comparing it to settled posts would read low. */
export const OUTCOME_MIN_AGE_MS = 48 * 3600_000;
/** One outcome per recommendation per this long. */
export const OUTCOME_EVERY_MS = 24 * 3600_000;
/** Links older than this are no longer re-measured: their last outcome stands. */
export const OUTCOME_TRACK_MS = 30 * 24 * 3600_000;

export type OutcomeVerdict = "early signal up" | "early signal down" | "in line" | "too early";

export interface Outcome {
  metric: MetricKey;
  value: number | null;
  cohortMedian: number | null;
  /** Percent above (or below) the cohort median; null when the median is 0 or there is nothing to compare. */
  lift: number | null;
  /** Cohort posts compared against. */
  n: number;
  verdict: OutcomeVerdict;
  confidence: Confidence;
  summary: string;
}

const isPlatformName = (p: string): p is Platform => Object.prototype.hasOwnProperty.call(PLATFORM_META, p);
const platformName = (p: string) => (isPlatformName(p) ? PLATFORM_META[p].name : p);
const plural = (f: string) => (f === "story" ? "stories" : `${((POST_FORMATS as readonly string[]).includes(f) ? FORMAT_LABEL[f as PostFormat] : f).toLowerCase()}s`);
const time = (d: string | Date) => (d instanceof Date ? d.getTime() : Date.parse(d));

/**
 * `post` is null when the post is not published yet. Cohort posts younger than OUTCOME_MIN_AGE_MS or without the
 * metric are left out, for the same reason the post itself waits.
 */
export function computeOutcome(post: PostRecord | null, cohort: PostRecord[], metric: MetricKey, now: Date | number = Date.now()): Outcome {
  const at = now instanceof Date ? now.getTime() : now;
  const name = METRIC_LABEL[metric].toLowerCase();
  const early = (summary: string, n = 0, value: number | null = null, cohortMedian: number | null = null): Outcome => ({ metric, value, cohortMedian, lift: null, n, verdict: "too early", confidence: confidenceOf(n), summary });
  if (!post) return early("Too early: the post is not published yet.");
  const others = (Array.isArray(cohort) ? cohort : [])
    .filter((p) => p && p.id !== post.id && p.platform === post.platform && p.format === post.format)
    .filter((p) => at - time(p.publishedAt) >= OUTCOME_MIN_AGE_MS)
    .map((p) => metricValue(p, metric))
    .filter((v): v is number => v !== null);
  const n = others.length;
  const value = metricValue(post, metric);
  const base = n ? median(others) : null;
  const age = at - time(post.publishedAt);
  if (!Number.isFinite(age) || age < OUTCOME_MIN_AGE_MS) return early("Too early: numbers keep climbing for the first 48 hours, so Outlly waits before comparing.", n, value, base);
  if (value === null) return early(`Too early: no ${name} have come back for this post yet.`, n, null, base);
  if (n < MIN_SAMPLE || base === null) return early(`Too early: Outlly needs at least ${MIN_SAMPLE} other ${platformName(post.platform)} ${plural(post.format)} to compare with (has ${n}).`, n, value, base);
  const lift = base > 0 ? Math.round(((value - base) / base) * 100) : null;
  const verdict: OutcomeVerdict = lift === null ? (value > 0 ? "early signal up" : "in line") : lift >= SIGNAL_MIN_LIFT ? "early signal up" : lift <= -SIGNAL_MIN_LIFT ? "early signal down" : "in line";
  const where = `your ${n} other ${platformName(post.platform)} ${plural(post.format)}`;
  const v = formatMetric(metric, value);
  const b = formatMetric(metric, base);
  const summary =
    verdict === "in line"
      ? `In line: ${v} ${name}, close to the ${b} median of ${where}.`
      : lift === null
        ? `Early signal up: ${v} ${name}, where the median of ${where} is ${b}. One post is not proof.`
        : `Early signal ${verdict === "early signal up" ? "up" : "down"}: ${v} ${name}, ${Math.abs(lift)}% ${lift > 0 ? "above" : "below"} the ${b} median of ${where}. One post is not proof.`;
  return { metric, value, cohortMedian: base, lift, n, verdict, confidence: confidenceOf(n), summary };
}
