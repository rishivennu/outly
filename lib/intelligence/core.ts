/**
 * R1232: Outlly Intelligence, the deterministic engine core. Pure on purpose: no I/O, no Prisma, no React, so the
 * dashboard, the weekly report, the planner and the tests all read the same maths.
 *
 * The honesty rules of lib/analytics/core.ts hold here too:
 *  - a metric a platform does not report is `unavailable`, never 0, and one a format cannot have is `unsupported`;
 *  - posts are only compared with posts of the same platform and the same format (like with like);
 *  - nothing is claimed below MIN_SAMPLE posts, and every claim carries its sample size and a confidence label;
 *  - recommendations come only from measured lifts. AI may word them later, it never invents them.
 */

import { rangeLabel, resolveRange } from "../analytics/core";
import { trend } from "../analytics/trend";
import { PLATFORM_META, type Platform } from "../domain";
import { FORMAT_LABEL, POST_FORMATS, supportsFormat, type PostFormat } from "../formats";
import { engagementRate, formatMetric, METRIC_LABEL, type MetricKey } from "../insights/post-core";
import { median } from "../live/suggest";

/* ------------------------------------------------------------------ objectives */

export type Objective = "awareness" | "engagement" | "community" | "traffic" | "leads" | "sales";
export const OBJECTIVES: readonly Objective[] = ["awareness", "engagement", "community", "traffic", "leads", "sales"];
export const isObjective = (x: unknown): x is Objective => typeof x === "string" && (OBJECTIVES as readonly string[]).includes(x);

/**
 * The metrics that matter for each objective, most important first. `proxy` is true when no platform gives the real
 * measure (no link clicks or conversions anywhere), so the page can say the metrics stand in for it.
 */
export const OBJECTIVE_METRICS: Record<Objective, { metrics: MetricKey[]; reason: string; proxy: boolean }> = {
  awareness: { metrics: ["views", "reach", "impressions", "shares"], reason: "Awareness is about how many people saw it, and shares carry it to new people.", proxy: false },
  engagement: { metrics: ["engagementRate", "comments", "likes", "shares", "saves"], reason: "Engagement is how much of the audience reacted, so the rate leads and raw counts follow.", proxy: false },
  community: { metrics: ["comments", "shares", "saves", "likes"], reason: "Community grows from conversations: comments first, then shares and saves.", proxy: false },
  traffic: { metrics: ["shares", "saves", "views"], reason: "No platform reports link clicks to Outlly, so shares and saves stand in for intent to visit.", proxy: true },
  leads: { metrics: ["comments", "saves", "shares"], reason: "No platform reports leads to Outlly, so comments and saves stand in for people asking to hear more.", proxy: true },
  sales: { metrics: ["saves", "comments", "shares"], reason: "No platform reports sales to Outlly, so saves and comments stand in for buying interest.", proxy: true },
};

/* ------------------------------------------------------------------ availability */

/**
 * available: a real number came back. unavailable: the platform does not give this metric (or did not for this
 * post). unsupported: this format cannot have it on this platform. zero: the platform really reported 0.
 */
export type Availability = "available" | "unavailable" | "unsupported" | "zero";

/**
 * R1232: what each platform's per-post reader can ever give. Mirrors CAN in lib/insights/post.ts, which is
 * server-only and cannot be imported here; tests/round-1232-intelligence-core.test.ts checks the two agree.
 */
export const PER_POST_METRICS: Record<string, readonly MetricKey[]> = {
  instagram: ["views", "reach", "likes", "comments", "shares", "saves", "engagementRate", "avgWatchSec", "watchTimeMin"],
  youtube: ["views", "likes", "comments", "shares", "engagementRate", "avgWatchSec", "watchTimeMin"],
  facebook: ["views", "reach", "likes", "comments", "avgWatchSec", "watchTimeMin", "engagementRate"],
  threads: ["views", "likes", "comments", "shares", "engagementRate"],
};

const WATCH: readonly MetricKey[] = ["watchTimeMin", "avgWatchSec"];
const isPlatformName = (p: string): p is Platform => Object.prototype.hasOwnProperty.call(PLATFORM_META, p);

/** The verdict for one metric of one post. Format rules come first: a story has no comments, only video has watch time. */
export function availabilityOf(platform: string, format: string, metric: MetricKey, value?: number | null): Availability {
  const fmt = (POST_FORMATS as readonly string[]).includes(format) ? (format as PostFormat) : null;
  if (fmt && isPlatformName(platform) && !supportsFormat(platform, fmt)) return "unsupported";
  if (WATCH.includes(metric) && fmt !== "video") return "unsupported";
  if (metric === "comments" && fmt === "story") return "unsupported";
  const can = PER_POST_METRICS[platform];
  if (!can || !can.includes(metric)) return "unavailable";
  if (typeof value !== "number" || !Number.isFinite(value)) return "unavailable";
  return value === 0 ? "zero" : "available";
}

/* ------------------------------------------------------------------ inputs */

export interface PostRecord {
  id: string;
  /** The ContentItem this post is a variation of, when known. */
  itemId?: string | null;
  platform: string;
  format: string;
  publishedAt: string | Date;
  topic?: string | null;
  categories?: string[] | null;
  metrics: Partial<Record<MetricKey, number | null>>;
  followersAtPublish?: number | null;
}

/** A metric value the engine may use (available or a real zero), or null. Engagement rate is worked out from views when it can be, so one group never mixes reach and views bases. */
export function metricValue(p: PostRecord, metric: MetricKey): number | null {
  let raw = p.metrics?.[metric];
  if (metric === "engagementRate") {
    const clean: Partial<Record<MetricKey, number>> = {};
    for (const k of ["views", "likes", "comments", "shares", "saves"] as const) {
      const v = p.metrics?.[k];
      const a = availabilityOf(p.platform, p.format, k, v);
      if ((a === "available" || a === "zero") && typeof v === "number") clean[k] = v;
    }
    raw = engagementRate(clean, "views") ?? raw;
  }
  const a = availabilityOf(p.platform, p.format, metric, raw);
  return a === "available" || a === "zero" ? (raw as number) : null;
}

const time = (d: string | Date) => (d instanceof Date ? d.getTime() : Date.parse(d));
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/* ------------------------------------------------------------------ confidence */

/** Below this many posts a group or topic is marked insufficient and never ranked. */
export const MIN_SAMPLE = 3;
export type Confidence = "low" | "medium" | "high";
const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** low below 5 posts, medium below 12, high from 12. */
export function confidenceOf(n: number): Confidence {
  if (!Number.isFinite(n) || n < 5) return "low";
  return n < 12 ? "medium" : "high";
}

/* ------------------------------------------------------------------ format performance */

export interface MetricStat {
  metric: MetricKey;
  availability: Availability;
  /** Median over the posts that have the metric (real zeroes included), null when none do. */
  median: number | null;
  n: number;
}

export interface FormatGroup {
  platform: string;
  format: string;
  n: number;
  /** ok: ranked inside the group. insufficient: fewer than MIN_SAMPLE posts with the lead metric. unavailable: the platform reports none of the objective's metrics. */
  status: "ok" | "insufficient" | "unavailable";
  /** The first objective metric with at least MIN_SAMPLE values in this group, the one its posts are ranked by. */
  primary: MetricKey | null;
  metrics: MetricStat[];
  engagementRate: number | null;
  /** Percent of all posts given. */
  postShare: number;
  /** Percent of this platform's views, never of views summed across platforms. Null when the platform gives no views. */
  viewShare: number | null;
  /** Best posts of this group by `primary`, compared only with each other. Empty unless status is ok. */
  top: { id: string; value: number }[];
}

const formatOrder = (f: string) => {
  const i = (POST_FORMATS as readonly string[]).indexOf(f);
  return i < 0 ? POST_FORMATS.length : i;
};
const platformOrder = (p: string) => {
  const i = Object.keys(PLATFORM_META).indexOf(p);
  return i < 0 ? 99 : i;
};
const groupKey = (p: Pick<PostRecord, "platform" | "format">) => `${p.platform}|${p.format}`;

function groupBy(posts: PostRecord[]): Map<string, PostRecord[]> {
  const m = new Map<string, PostRecord[]>();
  for (const p of posts) {
    const k = groupKey(p);
    const list = m.get(k);
    if (list) list.push(p);
    else m.set(k, [p]);
  }
  return m;
}

function statOf(posts: PostRecord[], metric: MetricKey): MetricStat {
  const values: number[] = [];
  const seen = new Set<Availability>();
  for (const p of posts) {
    seen.add(availabilityOf(p.platform, p.format, metric, metric === "engagementRate" ? metricValue(p, metric) : p.metrics?.[metric]));
    const v = metricValue(p, metric);
    if (v !== null) values.push(v);
  }
  const availability: Availability = seen.has("available") ? "available" : seen.has("zero") ? "zero" : seen.has("unsupported") ? "unsupported" : "unavailable";
  return { metric, availability, median: values.length ? round(median(values)) : null, n: values.length };
}

function primaryOf(posts: PostRecord[], objective: Objective): MetricKey | null {
  for (const m of OBJECTIVE_METRICS[objective].metrics) if (statOf(posts, m).n >= MIN_SAMPLE) return m;
  return null;
}

/**
 * Per platform and format: sample size, medians of the objective's metrics, engagement rate and share. Groups are
 * never ranked against each other (a carousel is not a video); inside a group with enough posts the best ones are.
 */
export function formatPerformance(posts: PostRecord[], objective: Objective): FormatGroup[] {
  const list = Array.isArray(posts) ? posts : [];
  if (!list.length || !isObjective(objective)) return [];
  const viewsByPlatform = new Map<string, number>();
  for (const p of list) {
    const v = metricValue(p, "views");
    if (v !== null) viewsByPlatform.set(p.platform, (viewsByPlatform.get(p.platform) ?? 0) + v);
  }
  const out: FormatGroup[] = [];
  for (const group of groupBy(list).values()) {
    const { platform, format } = group[0];
    const metrics = OBJECTIVE_METRICS[objective].metrics.map((m) => statOf(group, m));
    const primary = primaryOf(group, objective);
    const live = metrics.some((s) => s.availability === "available" || s.availability === "zero");
    const status: FormatGroup["status"] = !live ? "unavailable" : primary ? "ok" : "insufficient";
    const er = statOf(group, "engagementRate");
    const views = group.reduce((a, p) => a + (metricValue(p, "views") ?? 0), 0);
    const total = viewsByPlatform.get(platform);
    const top =
      status === "ok" && primary
        ? group
            .map((p) => ({ id: p.id, value: metricValue(p, primary) }))
            .filter((x): x is { id: string; value: number } => x.value !== null)
            .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .slice(0, 3)
        : [];
    out.push({
      platform,
      format,
      n: group.length,
      status,
      primary,
      metrics,
      engagementRate: er.median,
      postShare: round((group.length / list.length) * 100, 1),
      viewShare: total ? round((views / total) * 100, 1) : null,
      top,
    });
  }
  return out.sort((a, b) => platformOrder(a.platform) - platformOrder(b.platform) || a.platform.localeCompare(b.platform, "en") || formatOrder(a.format) - formatOrder(b.format) || a.format.localeCompare(b.format, "en"));
}

/* ------------------------------------------------------------------ topics */

export interface TopicInsight {
  topic: string;
  n: number;
  /** Posts with a like-for-like score (a value for their group's lead metric and a non-zero group median). */
  scored: number;
  metrics: MetricStat[];
  engagementRate: number | null;
  postShare: number;
  /** Median of each post against the median of its own platform and format, as a percent above (or below) it. */
  lift: number | null;
  /** The lead metric most of the scored posts were judged on. */
  metric: MetricKey | null;
  confidence: Confidence;
  sufficient: boolean;
  /** 1 for the best sufficient topic, null when insufficient. */
  rank: number | null;
  /** The platform and format most of this topic's posts went out as. */
  platform: string;
  format: string;
}

const topicsOf = (p: PostRecord) => {
  const names = [p.topic, ...(p.categories ?? [])].map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean);
  return [...new Set(names)];
};

/** Each post's value divided by its own platform+format median on that group's lead metric. */
function relativeScores(posts: PostRecord[], objective: Objective): Map<string, { score: number; metric: MetricKey }> {
  const out = new Map<string, { score: number; metric: MetricKey }>();
  for (const group of groupBy(posts).values()) {
    const primary = primaryOf(group, objective);
    if (!primary) continue;
    const base = statOf(group, primary).median;
    if (!base) continue;
    for (const p of group) {
      const v = metricValue(p, primary);
      if (v !== null) out.set(p.id, { score: v / base, metric: primary });
    }
  }
  return out;
}

const mostCommon = <T extends string>(xs: T[], order: (x: T) => number): T | null => {
  const c = new Map<T, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || order(a[0]) - order(b[0]) || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
};

/**
 * Per topic or category: the same stats as a format group, plus the lift against the account's own like-for-like
 * median. Posts with no topic are the baseline, never a topic. Ranked by lift among sufficient topics only.
 */
export function topicInsights(posts: PostRecord[], objective: Objective): TopicInsight[] {
  const list = Array.isArray(posts) ? posts : [];
  if (!list.length || !isObjective(objective)) return [];
  const scores = relativeScores(list, objective);
  const byTopic = new Map<string, PostRecord[]>();
  for (const p of list) for (const t of topicsOf(p)) byTopic.set(t, [...(byTopic.get(t) ?? []), p]);
  const metricOrder = (m: MetricKey) => OBJECTIVE_METRICS[objective].metrics.indexOf(m);
  const out: TopicInsight[] = [];
  for (const [topic, group] of byTopic) {
    const s = group.map((p) => scores.get(p.id)).filter((x): x is { score: number; metric: MetricKey } => !!x);
    const sufficient = s.length >= MIN_SAMPLE;
    const top = mostCommon(group.map(groupKey), (k) => platformOrder(k.split("|")[0]) * 10 + formatOrder(k.split("|")[1])) ?? "|";
    const [platform, format] = top.split("|");
    out.push({
      topic,
      n: group.length,
      scored: s.length,
      metrics: OBJECTIVE_METRICS[objective].metrics.map((m) => statOf(group, m)),
      engagementRate: statOf(group, "engagementRate").median,
      postShare: round((group.length / list.length) * 100, 1),
      lift: s.length ? round((median(s.map((x) => x.score)) - 1) * 100, 1) : null,
      metric: mostCommon(s.map((x) => x.metric), metricOrder),
      confidence: confidenceOf(s.length),
      sufficient,
      rank: null,
      platform,
      format,
    });
  }
  out.sort((a, b) => Number(b.sufficient) - Number(a.sufficient) || (b.lift ?? -Infinity) - (a.lift ?? -Infinity) || b.scored - a.scored || (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));
  let r = 0;
  for (const t of out) if (t.sufficient && t.lift !== null) t.rank = ++r;
  return out;
}

/* ------------------------------------------------------------------ periods */

export interface Period {
  from: string;
  /** Exclusive end. */
  to: string;
  label: string;
  days: number;
}

/** The last `days` whole UTC days up to and including today, with the label the cards show. */
export function periodOf(now: Date | number, days: number): Period {
  const t = typeof now === "number" ? now : now instanceof Date ? now.getTime() : NaN;
  const safeNow = Number.isFinite(t) ? t : 0;
  const d = Number.isFinite(days) && days >= 1 ? Math.floor(days) : 1;
  const w = resolveRange({ days: d }, d, safeNow);
  return { from: w.from, to: w.to, label: rangeLabel(w), days: w.days };
}

/** The period of the same length just before `p`, the fair baseline for a change. */
export function previousPeriod(p: Period): Period {
  const from = Date.parse(p.from);
  const len = Date.parse(p.to) - from;
  const w = { from: new Date(from - len).toISOString(), to: p.from };
  return { ...w, label: rangeLabel(w), days: p.days };
}

const inPeriod = (p: PostRecord, w: Period) => {
  const t = time(p.publishedAt);
  return Number.isFinite(t) && t >= Date.parse(w.from) && t < Date.parse(w.to);
};

/* ------------------------------------------------------------------ signals */

/** A change smaller than this percent is noise, not something working or needing attention. */
export const SIGNAL_MIN_LIFT = 20;

export interface Evidence {
  metric: MetricKey;
  /** For format trends the median now; for topics an index where 100 is the like-for-like median. */
  value: number;
  baseline: number;
  unit: "count" | "percent" | "index";
  /** Percent above (or below) the baseline. */
  lift: number;
  n: number;
  /** Posts in the baseline (the previous period for trends, the account for topics). */
  baselineN: number;
  period: string;
}

export interface Signal {
  id: string;
  kind: "format_trend" | "topic_lift";
  direction: "up" | "down";
  title: string;
  platform: string;
  format: string;
  topic: string | null;
  evidence: Evidence;
  confidence: Confidence;
  postsAnalyzed: number;
  /** Ids of the posts the claim rests on, best first, so the page can link to them. */
  examples: string[];
}

const platformName = (p: string) => (isPlatformName(p) ? PLATFORM_META[p].name : p);
const formatName = (f: string) => ((POST_FORMATS as readonly string[]).includes(f) ? FORMAT_LABEL[f as PostFormat] : f);
const plural = (f: string) => (f === "story" ? "stories" : `${formatName(f).toLowerCase()}s`);
const metricName = (m: MetricKey) => METRIC_LABEL[m].toLowerCase();

function computeSignals(posts: PostRecord[], objective: Objective, period: Period): Signal[] {
  const list = Array.isArray(posts) ? posts : [];
  if (!list.length || !isObjective(objective) || !period || !Number.isFinite(Date.parse(period.from)) || !Number.isFinite(Date.parse(period.to))) return [];
  const prevP = previousPeriod(period);
  const cur = list.filter((p) => inPeriod(p, period));
  const prev = list.filter((p) => inPeriod(p, prevP));
  const out: Signal[] = [];
  const periods = { curStart: Date.parse(period.from), prevStart: Date.parse(prevP.from), curEnd: Date.parse(period.to) };

  const prevGroups = groupBy(prev);
  for (const group of groupBy(cur).values()) {
    const { platform, format } = group[0];
    const primary = primaryOf(group, objective);
    const before = prevGroups.get(groupKey(group[0]));
    if (!primary || !before) continue;
    const now = statOf(group, primary);
    const then = statOf(before, primary);
    if (now.median === null || then.median === null || then.n < MIN_SAMPLE) continue;
    // R1232: the same fairness gate as the analytics cards (lib/analytics/trend.ts): no change without a real previous number.
    const t = trend(now.median, then.median, periods);
    if (t.kind !== "change" || Math.abs(t.pct) < SIGNAL_MIN_LIFT) continue;
    const lift = round(t.pct, 1);
    const up = lift > 0;
    const examples = group
      .map((p) => ({ id: p.id, v: metricValue(p, primary) ?? -1 }))
      .sort((a, b) => (up ? b.v - a.v : a.v - b.v) || (a.id < b.id ? -1 : 1))
      .slice(0, 3)
      .map((x) => x.id);
    out.push({
      id: `format:${platform}:${format}:${primary}`,
      kind: "format_trend",
      direction: up ? "up" : "down",
      title: `${platformName(platform)} ${plural(format)}: ${metricName(primary)} ${up ? "up" : "down"} ${Math.round(Math.abs(lift))}%`,
      platform,
      format,
      topic: null,
      evidence: { metric: primary, value: now.median, baseline: then.median, unit: primary === "engagementRate" ? "percent" : "count", lift, n: now.n, baselineN: then.n, period: period.label },
      confidence: confidenceOf(Math.min(now.n, then.n)),
      postsAnalyzed: group.length + before.length,
      examples,
    });
  }

  const scores = relativeScores(cur, objective);
  for (const t of topicInsights(cur, objective)) {
    if (!t.sufficient || t.lift === null || !t.metric || Math.abs(t.lift) < SIGNAL_MIN_LIFT) continue;
    const up = t.lift > 0;
    const examples = cur
      .filter((p) => topicsOf(p).includes(t.topic) && scores.has(p.id))
      .map((p) => ({ id: p.id, s: scores.get(p.id)?.score ?? 0 }))
      .sort((a, b) => (up ? b.s - a.s : a.s - b.s) || (a.id < b.id ? -1 : 1))
      .slice(0, 3)
      .map((x) => x.id);
    out.push({
      id: `topic:${t.topic.toLowerCase()}:${t.metric}`,
      kind: "topic_lift",
      direction: up ? "up" : "down",
      title: `Posts about ${t.topic}: ${Math.round(Math.abs(t.lift))}% ${up ? "above" : "below"} your usual ${metricName(t.metric)}`,
      platform: t.platform,
      format: t.format,
      topic: t.topic,
      evidence: { metric: t.metric, value: round(100 + t.lift, 1), baseline: 100, unit: "index", lift: t.lift, n: t.scored, baselineN: scores.size, period: period.label },
      confidence: t.confidence,
      postsAnalyzed: scores.size,
      examples,
    });
  }
  return out;
}

const bySignalStrength = (a: Signal, b: Signal) =>
  CONF_RANK[b.confidence] - CONF_RANK[a.confidence] || Math.abs(b.evidence.lift) - Math.abs(a.evidence.lift) || b.evidence.n - a.evidence.n || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** What is clearly ahead in `period`: format groups up on their previous period, topics above the like-for-like median. Strongest first. */
export function whatIsWorking(posts: PostRecord[], objective: Objective, period: Period): Signal[] {
  return computeSignals(posts, objective, period).filter((s) => s.direction === "up").sort(bySignalStrength);
}

/** The mirror of whatIsWorking: groups down on their previous period, topics below the like-for-like median. */
export function whatNeedsAttention(posts: PostRecord[], objective: Objective, period: Period): Signal[] {
  return computeSignals(posts, objective, period).filter((s) => s.direction === "down").sort(bySignalStrength);
}

/* ------------------------------------------------------------------ recommendations */

export interface BrandHints {
  name?: string | null;
  niche?: string | null;
}

export interface Recommendation {
  /** Stable key: the signal it came from, so the same advice is never stored twice. */
  id: string;
  title: string;
  format: string;
  platform: string;
  concept: string;
  why: string;
  evidence: Evidence;
  postsAnalyzed: number;
  period: string;
  confidence: Confidence;
  nextAction: { kind: "create"; label: string; prefill: { platform: string; format: string; topic: string | null; basedOn: string[] } };
}

export const MAX_RECOMMENDATIONS = 5;
export const NO_DATA_REASON = `Not enough data yet: Outlly needs at least ${MIN_SAMPLE} posts of the same platform and format with numbers, in this period and the one before, to see what is working.`;

const valueText = (e: Evidence) => (e.unit === "count" ? formatMetric(e.metric, e.value) : e.unit === "percent" ? `${e.value.toFixed(2)}%` : String(e.value));
const baseText = (e: Evidence) => (e.unit === "count" ? formatMetric(e.metric, e.baseline) : e.unit === "percent" ? `${e.baseline.toFixed(2)}%` : String(e.baseline));

/**
 * Drafts built only from upward signals, at most MAX_RECOMMENDATIONS, strongest first. No signal, no draft: the
 * reason says why the list is empty instead of padding it with generic tips.
 */
export function recommendationsFrom(signals: Signal[], brand?: BrandHints | null): { recommendations: Recommendation[]; reason: string | null } {
  const ups = (Array.isArray(signals) ? signals : []).filter((s) => s && s.direction === "up" && s.evidence && s.evidence.lift > 0).sort(bySignalStrength);
  const seen = new Set<string>();
  const out: Recommendation[] = [];
  const niche = brand?.niche?.trim();
  for (const s of ups) {
    if (seen.has(s.id) || out.length >= MAX_RECOMMENDATIONS) continue;
    seen.add(s.id);
    const e = s.evidence;
    const where = `${platformName(s.platform)} ${formatName(s.format).toLowerCase()}`;
    const audience = niche ? ` for your ${niche} audience` : "";
    const lift = Math.round(e.lift);
    const rec: Recommendation =
      s.kind === "topic_lift" && s.topic
        ? {
            id: `rec:${s.id}`,
            title: `Make another ${where} about ${s.topic}`,
            format: s.format,
            platform: s.platform,
            concept: `A ${where} about ${s.topic}${audience}, built like your best posts on it.`,
            why: `Your posts about ${s.topic} got ${lift}% more ${metricName(e.metric)} than your usual posts of the same platform and format (${e.n} posts, ${e.period}).`,
            evidence: e,
            postsAnalyzed: s.postsAnalyzed,
            period: e.period,
            confidence: s.confidence,
            nextAction: { kind: "create", label: "Draft it in Content Studio", prefill: { platform: s.platform, format: s.format, topic: s.topic, basedOn: s.examples } },
          }
        : {
            id: `rec:${s.id}`,
            title: `Post another ${where}`,
            format: s.format,
            platform: s.platform,
            concept: `Another ${where}${audience}, in the style of your best recent ones.`,
            why: `Your ${platformName(s.platform)} ${plural(s.format)} got a median of ${valueText(e)} ${metricName(e.metric)} (${e.n} posts, ${e.period}), up ${lift}% on ${baseText(e)} across the ${e.baselineN} before.`,
            evidence: e,
            postsAnalyzed: s.postsAnalyzed,
            period: e.period,
            confidence: s.confidence,
            nextAction: { kind: "create", label: "Draft it in Content Studio", prefill: { platform: s.platform, format: s.format, topic: null, basedOn: s.examples } },
          };
    out.push(rec);
  }
  return { recommendations: out, reason: out.length ? null : NO_DATA_REASON };
}

/* ------------------------------------------------------------------ classification */

export interface CategoryDef {
  id: string;
  name: string;
  keywords: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The category whose keywords (and name) appear most often in `text`, as whole words, ignoring case. Ties go to the
 * first category in the list; no hit returns null. Used to backfill topics on posts published before categories existed.
 */
export function classifyTopic(text: string | null | undefined, categories: CategoryDef[]): CategoryDef | null {
  if (typeof text !== "string" || !text.trim() || !Array.isArray(categories)) return null;
  let best: CategoryDef | null = null;
  let bestScore = 0;
  for (const c of categories) {
    if (!c) continue;
    const words = [c.name, ...(Array.isArray(c.keywords) ? c.keywords : [])].map((k) => (typeof k === "string" ? k.trim() : "")).filter(Boolean);
    let score = 0;
    for (const w of new Set(words.map((x) => x.toLowerCase()))) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(w).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}_])`, "giu");
      score += text.match(re)?.length ?? 0;
    }
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
