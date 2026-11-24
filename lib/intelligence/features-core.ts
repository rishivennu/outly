/**
 * R1318: Personal Intelligence, feature extraction. Pure on purpose: one published destination (a PostTarget with
 * its Post, Media and numbers) in, one versioned ContentFeatures row out. The same input always gives the same row,
 * so a ContentFeature can be recomputed at any time and compared across FEATURE_VERSION bumps.
 *
 * Rules:
 *  - raw numbers stay in TargetMetric; `perf` holds derived totals and rates only, with the availability rules of
 *    lib/intelligence/core.ts (a metric a platform never reports is absent, never 0);
 *  - a post is `measured` when it has a views total and is at least MEASURE_MIN_AGE_MS old, so a post published an
 *    hour ago never drags a creator's medians down;
 *  - text features are counts and flags, never the text itself: a ContentFeature row holds no caption copy.
 */

import { availabilityOf, metricValue, type PostRecord } from "./core";
import type { MetricKey } from "../insights/post-core";

/** Bump when a feature is added, renamed or computed differently. Rows of an older version are recomputed by the sweep. */
export const FEATURE_VERSION = 1;

/** A post younger than this has no settled numbers: not measured, never a baseline. */
export const MEASURE_MIN_AGE_MS = 24 * 36e5;

export type Aspect = "vertical" | "square" | "horizontal" | "unknown";
export type HookType = "question" | "number" | "statement" | "none";

export interface ContentFeatures {
  version: number;
  platform: string;
  format: string;
  /** Text: counts and flags of the copy as it went to this platform (title + caption + hashtags of the PostTarget). */
  titleLen: number;
  captionLen: number;
  captionWords: number;
  hashtagCount: number;
  mentionCount: number;
  emojiCount: number;
  linkCount: number;
  hasHook: boolean;
  hookLen: number;
  hookType: HookType;
  hasQuestion: boolean;
  hasCta: boolean;
  hasFirstComment: boolean;
  hasCover: boolean;
  /** Media: duration in seconds and shape; photo posts have null duration. */
  durationSec: number | null;
  aspect: Aspect;
  slides: number;
  /** Publishing: in the creator's timezone. */
  weekday: number; // 0 Sunday .. 6 Saturday
  hour: number; // 0..23
  /** Days since this creator's previous published destination on the same platform, null for the first. */
  gapDays: number | null;
  /** How many platforms the same Post went to (1 = this one only). */
  crossPosted: number;
  isAdapted: boolean;
  topic: string | null;
  categories: string[];
}

export interface PerfFeatures {
  version: number;
  /** Age of the post when the totals were read, in whole days. */
  ageDays: number;
  measured: boolean;
  /** Totals per metric the platform reports (available or a real zero); absent otherwise. */
  totals: Partial<Record<MetricKey, number>>;
  engagementRate: number | null;
  /** Views per follower at publish, when the account's follower count that day is known. */
  viewsPerFollower: number | null;
}

export interface FeatureInput {
  /** The PostRecord shape loadPostRecords builds, plus the copy and media the extractor needs. */
  record: PostRecord;
  title?: string | null;
  caption?: string | null;
  description?: string | null;
  hashtags?: string | null;
  hook?: string | null;
  firstComment?: string | null;
  coverKey?: string | null;
  media?: { duration?: number | null; width?: number | null; height?: number | null } | null;
  slides?: number;
  timezone?: string | null;
  previousPublishedAt?: string | Date | null;
  crossPosted?: number;
  isAdapted?: boolean;
  followersAtPublish?: number | null;
}

const CTA = /\b(link in bio|comment below|let me know|follow for|follow me|subscribe|share this|save this|tag (a|someone)|dm me|check out|sign up|join (us|the)|watch till|part 2)\b/i;
const URL = /https?:\/\/\S+|\bwww\.\S+/gi;
const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;
const MENTION = /(^|\s)@[\p{L}\p{N}_.]+/gu;
const EMOJI = /\p{Extended_Pictographic}/gu;

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const clean = (s: string | null | undefined) => (typeof s === "string" ? s.trim() : "");
const time = (d: string | Date | number) => (d instanceof Date ? d.getTime() : typeof d === "number" ? d : Date.parse(d));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Question first, then a leading number ("3 ways", "90% of"), else a statement. */
export function hookTypeOf(hook: string): HookType {
  const h = clean(hook);
  if (!h) return "none";
  if (/\?/.test(h)) return "question";
  if (/^\W*\d/.test(h) || /\b\d+\s?%/.test(h)) return "number";
  return "statement";
}

export function aspectOf(width?: number | null, height?: number | null): Aspect {
  if (!width || !height || width <= 0 || height <= 0) return "unknown";
  const r = width / height;
  if (r < 0.9) return "vertical";
  if (r <= 1.1) return "square";
  return "horizontal";
}

/** Weekday and hour of `at` in `tz`, falling back to UTC on an unknown zone (never throws). */
export function localWeekdayHour(at: string | Date | number, tz?: string | null): { weekday: number; hour: number } {
  const d = new Date(time(at));
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "short", hour: "numeric", hour12: false }).formatToParts(d);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const hr = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
    return { weekday: weekday < 0 ? d.getUTCDay() : weekday, hour: Number.isFinite(hr) ? hr : d.getUTCHours() };
  } catch {
    return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
  }
}

export function extractFeatures(input: FeatureInput): ContentFeatures {
  const { record } = input;
  const title = clean(input.title);
  const caption = [clean(input.caption), clean(input.description)].filter(Boolean).join("\n");
  const tags = clean(input.hashtags);
  const hook = clean(input.hook);
  const all = `${title}\n${caption}\n${tags}`;
  const { weekday, hour } = localWeekdayHour(record.publishedAt, input.timezone);
  const prev = input.previousPublishedAt ? time(input.previousPublishedAt) : NaN;
  const gap = Number.isFinite(prev) ? (time(record.publishedAt) - prev) / 864e5 : null;
  const duration = record.format === "video" && input.media?.duration && input.media.duration > 0 ? r2(input.media.duration) : null;
  return {
    version: FEATURE_VERSION,
    platform: record.platform,
    format: record.format,
    titleLen: title.length,
    captionLen: caption.length,
    captionWords: caption ? caption.split(/\s+/).filter(Boolean).length : 0,
    hashtagCount: count(all, HASHTAG),
    mentionCount: count(all, MENTION),
    emojiCount: count(all, EMOJI),
    linkCount: count(all, URL),
    hasHook: hook.length > 0,
    hookLen: hook.length,
    hookType: hookTypeOf(hook),
    hasQuestion: /\?/.test(hook) || /\?/.test(caption.slice(0, 160)),
    hasCta: CTA.test(all),
    hasFirstComment: clean(input.firstComment).length > 0,
    hasCover: clean(input.coverKey).length > 0,
    durationSec: duration,
    aspect: aspectOf(input.media?.width, input.media?.height),
    slides: Math.max(0, Math.floor(input.slides ?? 0)),
    weekday,
    hour,
    gapDays: gap === null || gap < 0 ? null : r2(gap),
    crossPosted: Math.max(1, Math.floor(input.crossPosted ?? 1)),
    isAdapted: input.isAdapted === true,
    topic: record.topic ?? null,
    categories: [...(record.categories ?? [])].slice(0, 10),
  };
}

const TOTAL_KEYS: readonly MetricKey[] = ["views", "reach", "impressions", "likes", "comments", "shares", "saves", "watchTimeMin", "avgWatchSec"];

/** Derived performance of one destination at `now`. Only what the platform reports; `measured` needs views and a day of age. */
export function extractPerf(record: PostRecord, now: number | Date, followersAtPublish?: number | null): PerfFeatures {
  const at = now instanceof Date ? now.getTime() : now;
  const age = at - time(record.publishedAt);
  const totals: PerfFeatures["totals"] = {};
  for (const k of TOTAL_KEYS) {
    const v = metricValue(record, k);
    if (v !== null) totals[k] = v;
  }
  const views = totals.views;
  const er = metricValue(record, "engagementRate");
  const followers = followersAtPublish ?? record.followersAtPublish ?? null;
  return {
    version: FEATURE_VERSION,
    ageDays: Math.max(0, Math.floor(age / 864e5)),
    measured: typeof views === "number" && availabilityOf(record.platform, record.format, "views", views) !== "unavailable" && age >= MEASURE_MIN_AGE_MS,
    totals,
    engagementRate: er === null ? null : r2(er),
    viewsPerFollower: typeof views === "number" && followers && followers > 0 ? r2(views / followers) : null,
  };
}

/** Parse a stored JSON column defensively: a row written by an older version is read, never thrown on. */
export function parseFeatures(raw: string | null | undefined): ContentFeatures | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ContentFeatures>;
    return v && typeof v === "object" && typeof v.platform === "string" && typeof v.format === "string" ? (v as ContentFeatures) : null;
  } catch {
    return null;
  }
}

export function parsePerf(raw: string | null | undefined): PerfFeatures | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PerfFeatures>;
    return v && typeof v === "object" && v.totals && typeof v.totals === "object" ? (v as PerfFeatures) : null;
  } catch {
    return null;
  }
}
