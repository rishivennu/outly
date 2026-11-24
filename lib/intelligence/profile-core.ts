/**
 * R1318: Personal Intelligence, the creator profile. Pure: ContentFeature rows of one workspace in, one profile
 * out, for the whole workspace (platform "") or one platform. Every number here is a count, a share, a median or a
 * lift over the creator's own posts; nothing is predicted and nothing is compared with other creators (that is the
 * shared layer, Phase 6).
 *
 * Personalization level (master prompt §6, the honesty ladder):
 *  - personal: at least PERSONAL_MIN measured posts in the window;
 *  - blended: BLENDED_MIN or more (the shared baseline still carries most of the weight);
 *  - general: a few posts, general guidance only, labelled as such;
 *  - none: nothing measured. No personal claim at all.
 */

import { median } from "../live/suggest";
import type { MetricKey } from "../insights/post-core";
import { FEATURE_VERSION, type ContentFeatures, type PerfFeatures } from "./features-core";

export const PROFILE_VERSION = 1;
export const PROFILE_WINDOW_DAYS = 90;
export const PERSONAL_MIN = 12;
export const BLENDED_MIN = 4;
/** A lift is reported only when both sides have this many measured posts. */
export const LIFT_MIN_EACH = 3;
/** Smaller lifts than this are noise for a creator-sized sample. */
export const LIFT_MIN_PCT = 15;
export const TOP_N = 5;

export type Level = "personal" | "blended" | "general" | "none";
export const LEVEL_LABEL: Record<Level, string> = {
  personal: "Based on your own results",
  blended: "Your results plus general guidance",
  general: "General guidance (few posts measured yet)",
  none: "No measured posts yet",
};

export function levelOf(measured: number): Level {
  if (measured >= PERSONAL_MIN) return "personal";
  if (measured >= BLENDED_MIN) return "blended";
  return measured >= 1 ? "general" : "none";
}

export interface FeatureRow {
  targetId: string;
  postId: string;
  platform: string;
  format: string;
  publishedAt: string | Date;
  features: ContentFeatures;
  perf: PerfFeatures | null;
}

export interface Share {
  key: string;
  n: number;
  pct: number;
}

export interface MetricProfile {
  metric: MetricKey;
  n: number;
  median: number;
  p75: number;
}

export interface Lift {
  /** The boolean trait compared, e.g. "hasHook". */
  trait: string;
  label: string;
  metric: MetricKey;
  withMedian: number;
  withoutMedian: number;
  nWith: number;
  nWithout: number;
  liftPct: number;
}

export interface CreatorProfileData {
  version: number;
  featureVersion: number;
  platform: string;
  window: { from: string; to: string; days: number };
  posts: { total: number; measured: number };
  level: Level;
  cadence: { postsPerWeek: number; medianGapDays: number | null; activeWeeks: number };
  formats: Share[];
  topics: Share[];
  categories: Share[];
  /** Rates are percentages of the posts in the window, null when there are none (never a made-up 0). */
  copy: { medianCaptionLen: number | null; medianHashtags: number | null; hookRate: number | null; questionRate: number | null; ctaRate: number | null; emojiRate: number | null };
  video: { medianDurationSec: number | null; verticalShare: number | null };
  timing: { weekdays: Share[]; hours: Share[] };
  performance: MetricProfile[];
  /** The lead metric the lifts are judged on (views where available, else the first measured metric). */
  leadMetric: MetricKey | null;
  lifts: Lift[];
}

const time = (d: string | Date) => (d instanceof Date ? d.getTime() : Date.parse(d));
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
const rate = (f: ContentFeatures[], test: (x: ContentFeatures) => boolean) => (f.length ? pct(f.filter(test).length, f.length) : null);

function shares(keys: (string | null | undefined)[], top = TOP_N): Share[] {
  const m = new Map<string, number>();
  let total = 0;
  for (const k of keys) {
    if (!k) continue;
    total++;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, top)
    .map(([key, n]) => ({ key, n, pct: pct(n, total) }));
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const weekdayLabel = (d: number) => WEEKDAY[((d % 7) + 7) % 7];
export const hourLabel = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;

const TRAITS: { trait: keyof ContentFeatures | "longCaption" | "manyTags" | "weekend" | "shortVideo"; label: string; test: (f: ContentFeatures) => boolean }[] = [
  { trait: "hasHook", label: "a written hook", test: (f) => f.hasHook },
  { trait: "hasQuestion", label: "a question in the hook or opening", test: (f) => f.hasQuestion },
  { trait: "hasCta", label: "a call to action", test: (f) => f.hasCta },
  { trait: "hasCover", label: "your own cover image", test: (f) => f.hasCover },
  { trait: "hasFirstComment", label: "a first comment", test: (f) => f.hasFirstComment },
  { trait: "longCaption", label: "a caption over 150 characters", test: (f) => f.captionLen > 150 },
  { trait: "manyTags", label: "five or more hashtags", test: (f) => f.hashtagCount >= 5 },
  { trait: "weekend", label: "a weekend publish", test: (f) => f.weekday === 0 || f.weekday === 6 },
  { trait: "shortVideo", label: "a video under 30 seconds", test: (f) => f.format === "video" && f.durationSec !== null && f.durationSec < 30 },
];

const LEAD_ORDER: readonly MetricKey[] = ["views", "reach", "likes", "comments", "engagementRate"];

function metricOf(p: PerfFeatures, k: MetricKey): number | null {
  if (k === "engagementRate") return p.engagementRate;
  const v = p.totals[k];
  return typeof v === "number" ? v : null;
}

/** The lifts of boolean traits on the lead metric, both sides at least LIFT_MIN_EACH measured posts, sorted by size. */
export function traitLifts(rows: FeatureRow[], lead: MetricKey): Lift[] {
  const measured = rows.filter((r) => r.perf?.measured && metricOf(r.perf, lead) !== null);
  const out: Lift[] = [];
  for (const t of TRAITS) {
    const yes = measured.filter((r) => t.test(r.features)).map((r) => metricOf(r.perf!, lead) as number);
    const no = measured.filter((r) => !t.test(r.features)).map((r) => metricOf(r.perf!, lead) as number);
    if (yes.length < LIFT_MIN_EACH || no.length < LIFT_MIN_EACH) continue;
    const a = median(yes);
    const b = median(no);
    if (!(b > 0)) continue;
    const lift = Math.round(((a - b) / b) * 100);
    if (Math.abs(lift) < LIFT_MIN_PCT) continue;
    out.push({ trait: t.trait, label: t.label, metric: lead, withMedian: r2(a), withoutMedian: r2(b), nWith: yes.length, nWithout: no.length, liftPct: lift });
  }
  return out.sort((x, y) => Math.abs(y.liftPct) - Math.abs(x.liftPct) || (x.trait < y.trait ? -1 : 1));
}

export interface BuildOpts {
  /** "" = every platform. */
  platform?: string;
  now: Date | number;
  days?: number;
}

/** The profile of one creator from their feature rows. Rows outside the window or of another platform are ignored. */
export function buildProfile(allRows: FeatureRow[], opts: BuildOpts): CreatorProfileData {
  const now = opts.now instanceof Date ? opts.now.getTime() : opts.now;
  const days = opts.days ?? PROFILE_WINDOW_DAYS;
  const from = now - days * 864e5;
  const platform = opts.platform ?? "";
  const rows = allRows
    .filter((r) => (platform ? r.platform === platform : true))
    .filter((r) => {
      const t = time(r.publishedAt);
      return Number.isFinite(t) && t >= from && t < now;
    })
    .sort((a, b) => time(a.publishedAt) - time(b.publishedAt));
  const measured = rows.filter((r) => r.perf?.measured);
  const f = rows.map((r) => r.features);

  // Cadence: posts per week over the window, gaps between consecutive posts (same platform only when one is picked).
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) gaps.push((time(rows[i].publishedAt) - time(rows[i - 1].publishedAt)) / 864e5);
  const weeks = new Set(rows.map((r) => Math.floor((time(r.publishedAt) - from) / (7 * 864e5))));

  const captionLens = f.map((x) => x.captionLen).filter((n) => n > 0);
  const tagCounts = f.map((x) => x.hashtagCount);
  const videos = f.filter((x) => x.format === "video");
  const durations = videos.map((x) => x.durationSec).filter((n): n is number => typeof n === "number" && n > 0);
  const shaped = videos.filter((x) => x.aspect !== "unknown");

  // Performance medians per metric over measured posts; only metrics at least one measured post reports.
  const performance: MetricProfile[] = [];
  const keys: MetricKey[] = ["views", "reach", "impressions", "likes", "comments", "shares", "saves", "watchTimeMin", "avgWatchSec", "engagementRate"];
  for (const k of keys) {
    const vals = measured.map((r) => metricOf(r.perf!, k)).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
    if (!vals.length) continue;
    performance.push({ metric: k, n: vals.length, median: r2(median(vals)), p75: r2(quantile(vals, 0.75)) });
  }
  const leadMetric = LEAD_ORDER.find((k) => performance.some((p) => p.metric === k && p.n >= LIFT_MIN_EACH * 2)) ?? null;

  return {
    version: PROFILE_VERSION,
    featureVersion: FEATURE_VERSION,
    platform,
    window: { from: new Date(from).toISOString().slice(0, 10), to: new Date(now).toISOString().slice(0, 10), days },
    posts: { total: rows.length, measured: measured.length },
    level: levelOf(measured.length),
    cadence: { postsPerWeek: r1(rows.length / (days / 7)), medianGapDays: gaps.length ? r1(median(gaps)) : null, activeWeeks: weeks.size },
    formats: shares(f.map((x) => x.format)),
    topics: shares(f.map((x) => x.topic)),
    categories: shares(f.flatMap((x) => x.categories)),
    copy: {
      medianCaptionLen: captionLens.length ? Math.round(median(captionLens)) : null,
      medianHashtags: tagCounts.length ? Math.round(median(tagCounts)) : null,
      hookRate: rate(f, (x) => x.hasHook),
      questionRate: rate(f, (x) => x.hasQuestion),
      ctaRate: rate(f, (x) => x.hasCta),
      emojiRate: rate(f, (x) => x.emojiCount > 0),
    },
    video: {
      medianDurationSec: durations.length ? r1(median(durations)) : null,
      verticalShare: shaped.length ? pct(shaped.filter((x) => x.aspect === "vertical").length, shaped.length) : null,
    },
    timing: { weekdays: shares(f.map((x) => weekdayLabel(x.weekday)), 3), hours: shares(f.map((x) => hourLabel(x.hour)), 3) },
    performance,
    leadMetric,
    lifts: leadMetric ? traitLifts(rows, leadMetric) : [],
  };
}

/** ISO week key (yyyy-Www) of a moment, UTC, for one snapshot a week per profile. */
export function weekKey(at: Date | number): string {
  const d = new Date(at instanceof Date ? at.getTime() : at);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 864e5 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function parseProfile(raw: string | null | undefined): CreatorProfileData | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CreatorProfileData>;
    return v && typeof v === "object" && v.posts && typeof v.level === "string" ? (v as CreatorProfileData) : null;
  } catch {
    return null;
  }
}
