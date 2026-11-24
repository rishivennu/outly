import { formatMetric, METRIC_LABEL } from "../insights/post-core";
import { confidenceOf, type Evidence, type Recommendation } from "./core";
import type { Lift, Level } from "./profile-core";
import { LEVEL_LABEL, LIFT_MIN_EACH, LIFT_MIN_PCT } from "./profile-core";
import type { ModelState } from "./model/predict";
import { FORMAT_LABEL, type PostFormat } from "../formats";
import { PLATFORM_META, type Platform } from "../domain";

/**
 * R1320: personal recommendations. The workspace engine (./core.ts) compares this period with the one before; this
 * one compares the creator with themself: the traits that moved their own numbers (profile lifts) and the format
 * their own history says does best on each platform (model baselines). Every draft carries the numbers it rests on,
 * names its sample, and is only made where the honesty ladder allows it: a platform with under BLENDED_MIN measured
 * posts (level none or general) gets a reason, never a recommendation. Pure: no clock, no database, no AI.
 */

export const PERSONAL_RULES = ["trait", "format"] as const;
export type PersonalRule = (typeof PERSONAL_RULES)[number];
export const PERSONAL_ID_PREFIX = "personal:";
/** At most this many per platform, so one busy platform never fills the whole list. */
export const PER_PLATFORM_MAX = 2;
export const PERSONAL_MAX = 5;
/** A format only beats another when its baseline is this much higher and both have a real sample. */
export const FORMAT_GAP_PCT = 25;
export const FORMAT_MIN_N = LIFT_MIN_EACH;

export const NO_PERSONAL_REASON = `Personal recommendations need at least ${LIFT_MIN_EACH} measured posts with a trait and ${LIFT_MIN_EACH} without it, or two formats with ${FORMAT_MIN_N} measured posts each, on one platform. Keep publishing; they appear on their own.`;

export interface PersonalInput {
  /** One state per platform (lib/intelligence/model/predict.ts statesFrom), computed from the creator's own rows. */
  states: ModelState[];
  /** The window the states were computed over, for the evidence period text. */
  window: { from: string; to: string; label: string };
}

export interface PersonalDrafts {
  recommendations: Recommendation[];
  /** Why the list is empty or short, when a platform could not be spoken for. */
  reason: string | null;
  /** The honesty level each platform was judged at, for the UI's ladder line. */
  levels: { platform: string; level: Level; measured: number }[];
}

const platformName = (p: string) => (Object.prototype.hasOwnProperty.call(PLATFORM_META, p) ? PLATFORM_META[p as Platform].name : p);
const formatName = (f: string) => (Object.prototype.hasOwnProperty.call(FORMAT_LABEL, f) ? FORMAT_LABEL[f as PostFormat] : f);
const num = (metric: Evidence["metric"], v: number) => (metric === "engagementRate" ? `${v.toFixed(2)}%` : formatMetric(metric, v));
const unitOf = (metric: Evidence["metric"]): Evidence["unit"] => (metric === "engagementRate" ? "percent" : "count");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The stable id of a personal draft: rule, subject and platform. Never the period, so one live row per advice. */
export const personalId = (rule: PersonalRule, subject: string, platform: string) => `${PERSONAL_ID_PREFIX}${rule}:${subject}:${platform}`;
export const isPersonalId = (id: string) => id.startsWith(PERSONAL_ID_PREFIX);

/** How a trait is asked for in the composer; the label is the lift's own words. */
const TRAIT_ADVICE: Record<string, { keep: string; drop: string; topic: string | null }> = {
  hasHook: { keep: "Open with a written hook", drop: "Try opening without a scripted hook", topic: null },
  hasQuestion: { keep: "Ask a question in the opening", drop: "Lead with a statement, not a question", topic: null },
  hasCta: { keep: "End with a call to action", drop: "Leave out the call to action", topic: null },
  hasCover: { keep: "Upload your own cover image", drop: "Let the platform pick the cover", topic: null },
  hasFirstComment: { keep: "Add a first comment", drop: "Skip the first comment", topic: null },
  longCaption: { keep: "Write a longer caption (over 150 characters)", drop: "Keep the caption under 150 characters", topic: null },
  manyTags: { keep: "Use five or more hashtags", drop: "Use fewer than five hashtags", topic: null },
  weekend: { keep: "Publish on a weekend", drop: "Publish on a weekday", topic: null },
  shortVideo: { keep: "Keep videos under 30 seconds", drop: "Give videos more than 30 seconds", topic: null },
};

function traitDraft(platform: string, l: Lift, window: PersonalInput["window"], measured: number): Recommendation | null {
  const advice = TRAIT_ADVICE[l.trait];
  if (!advice || Math.abs(l.liftPct) < LIFT_MIN_PCT || l.nWith < LIFT_MIN_EACH || l.nWithout < LIFT_MIN_EACH) return null;
  const up = l.liftPct > 0;
  const metric = METRIC_LABEL[l.metric].toLowerCase();
  const name = platformName(platform);
  const better = up ? l.withMedian : l.withoutMedian;
  const worse = up ? l.withoutMedian : l.withMedian;
  const nBetter = up ? l.nWith : l.nWithout;
  const nWorse = up ? l.nWithout : l.nWith;
  const gap = Math.abs(l.liftPct);
  const title = `${up ? advice.keep : advice.drop} on ${name}`;
  const concept = up
    ? `Your ${name} posts with ${l.label} reach a median of ${num(l.metric, better)} ${metric}; those without, ${num(l.metric, worse)}. Make the next one with ${l.label}.`
    : `Your ${name} posts without ${l.label} reach a median of ${num(l.metric, better)} ${metric}; those with it, ${num(l.metric, worse)}. Make the next one without.`;
  const why = `This is your own pattern, not a general rule: ${plural(nBetter, "post")} on one side against ${plural(nWorse, "post")} on the other, ${gap}% apart on ${metric}, ${window.label}.`;
  const evidence: Evidence = { metric: l.metric, value: better, baseline: worse, unit: unitOf(l.metric), lift: gap, n: nBetter, baselineN: nWorse, period: window.label };
  return {
    id: personalId("trait", l.trait, platform),
    title,
    format: "",
    platform,
    concept,
    why,
    evidence,
    postsAnalyzed: measured,
    period: window.label,
    confidence: confidenceOf(Math.min(l.nWith, l.nWithout) * 2),
    nextAction: { kind: "create", label: `Draft one for ${name}`, prefill: { platform, format: "", topic: advice.topic, basedOn: [] } },
  };
}

function formatDraft(state: ModelState, window: PersonalInput["window"]): Recommendation | null {
  const real = state.byFormat.filter((f) => f.n >= FORMAT_MIN_N && f.level !== "general");
  if (real.length < 2) return null;
  const sorted = [...real].sort((a, b) => b.predicted - a.predicted || (a.format < b.format ? -1 : 1));
  const best = sorted[0];
  const next = sorted[1];
  if (!(next.predicted > 0)) return null;
  const gap = Math.round(((best.predicted - next.predicted) / next.predicted) * 100);
  if (gap < FORMAT_GAP_PCT) return null;
  const name = platformName(state.platform);
  const bf = formatName(best.format).toLowerCase();
  const nf = formatName(next.format).toLowerCase();
  const title = `Make your next ${name} post a ${bf}`;
  const concept = `On ${name}, a typical ${bf} of yours is heading for ${num("views", best.predicted)} views, a ${nf} for ${num("views", next.predicted)}. Put the next idea into a ${bf}.`;
  const why = `Your own baselines, ${window.label}: ${plural(best.n, `measured ${bf} post`)} against ${plural(next.n, `measured ${nf} post`)}, ${gap}% apart. An estimate from your history, not a promise.`;
  const evidence: Evidence = { metric: "views", value: best.predicted, baseline: next.predicted, unit: "count", lift: gap, n: best.n, baselineN: next.n, period: window.label };
  return {
    id: personalId("format", best.format, state.platform),
    title,
    format: best.format,
    platform: state.platform,
    concept,
    why,
    evidence,
    postsAnalyzed: state.measured,
    period: window.label,
    confidence: confidenceOf(Math.min(best.n, next.n) * 2),
    nextAction: { kind: "create", label: `Draft a ${bf} for ${name}`, prefill: { platform: state.platform, format: best.format, topic: null, basedOn: [] } },
  };
}

/**
 * The personal drafts for a creator, ordered by the size of the gap behind them, at most PER_PLATFORM_MAX per platform
 * and PERSONAL_MAX in all. Deterministic: the same states give the same drafts in the same order.
 */
export function personalRecommendations(input: PersonalInput): PersonalDrafts {
  const levels = input.states.map((s) => ({ platform: s.platform, level: s.level, measured: s.measured })).sort((a, b) => (a.platform < b.platform ? -1 : 1));
  const all: Recommendation[] = [];
  const thin: string[] = [];
  for (const s of input.states) {
    if (s.level === "none" || s.level === "general") {
      thin.push(s.platform);
      continue;
    }
    const mine: Recommendation[] = [];
    const f = formatDraft(s, input.window);
    if (f) mine.push(f);
    for (const l of s.lifts) {
      const d = traitDraft(s.platform, l, input.window, s.measured);
      if (d) mine.push(d);
    }
    mine.sort((a, b) => b.evidence.lift - a.evidence.lift || (a.id < b.id ? -1 : 1));
    all.push(...mine.slice(0, PER_PLATFORM_MAX));
  }
  all.sort((a, b) => b.evidence.lift - a.evidence.lift || (a.id < b.id ? -1 : 1));
  const recommendations = all.slice(0, PERSONAL_MAX);
  let reason: string | null = null;
  if (!recommendations.length) {
    reason = input.states.length
      ? thin.length === input.states.length
        ? `${NO_PERSONAL_REASON} Today: ${thin.map((p) => `${platformName(p)} is at "${LEVEL_LABEL[input.states.find((s) => s.platform === p)!.level]}"`).join(", ")}.`
        : "Your measured posts do not split on any trait or format by a clear margin yet, so there is nothing personal to recommend. The workspace recommendations above still apply."
      : "Nothing measured yet. Personal recommendations appear once your published posts are a day old and have numbers.";
  }
  return { recommendations, reason, levels };
}

/** One line of evidence for a personal card: both sides of the comparison with their samples. */
export function personalEvidenceLine(e: Evidence): string {
  const metric = METRIC_LABEL[e.metric].toLowerCase();
  return `Median ${num(e.metric, e.value)} ${metric} over ${plural(e.n, "post")} vs ${num(e.metric, e.baseline)} over ${plural(e.baselineN, "post")}, ${e.period}`;
}
