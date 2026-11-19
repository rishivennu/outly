/**
 * R1238: pure render-state helpers for the Content Intelligence page. Every word the cards show for a missing,
 * thin or impossible number comes from here, so a gap always reads as a gap and never as a 0.
 */
import { MIN_SAMPLE, SIGNAL_MIN_LIFT, confidenceOf } from "@/lib/intelligence/core";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { FORMAT_LABEL, type PostFormat } from "@/lib/formats";
import { METRIC_LABEL, formatMetric, type MetricKey } from "@/lib/insights/post-core";
import type { Confidence, Evidence, FormatGroup, MetricStat } from "./types";

export const DAY_OPTIONS = [7, 28, 90] as const;
export type DayOption = (typeof DAY_OPTIONS)[number];

export const isPlatformKey = (p: string): p is Platform => Object.prototype.hasOwnProperty.call(PLATFORM_META, p);
export const platformLabel = (p: string) => (isPlatformKey(p) ? PLATFORM_META[p].name : p);
export const formatLabel = (f: string) => (Object.prototype.hasOwnProperty.call(FORMAT_LABEL, f) ? FORMAT_LABEL[f as PostFormat] : f);
export const metricLabel = (m: MetricKey) => METRIC_LABEL[m];

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

export function statusWord(g: Pick<FormatGroup, "status" | "n" | "platform">): string {
  if (g.status === "ok") return "Ranked";
  if (g.status === "unavailable") return `Numbers not provided by ${platformLabel(g.platform)}`;
  return `Not enough posts yet: ${g.n} of the ${MIN_SAMPLE} needed`;
}

export const CONFIDENCE_WORD: Record<Confidence, string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

/** One cell: the median when there is one, otherwise the reason there is none. Never a made-up 0. */
export function metricCell(stat: MetricStat | undefined, platform: string, format: string): string {
  if (!stat) return "Not tracked for this objective";
  if (stat.availability === "unsupported") return `Not possible for a ${formatLabel(format).toLowerCase()} on ${platformLabel(platform)}`;
  if (stat.availability === "unavailable") return `Not provided by ${platformLabel(platform)}`;
  if (stat.median === null) return "No numbers yet";
  return formatMetric(stat.metric, stat.median);
}

export function engagementCell(g: Pick<FormatGroup, "engagementRate" | "status" | "platform">): string {
  if (g.engagementRate !== null) return formatMetric("engagementRate", g.engagementRate);
  return g.status === "unavailable" ? `Not provided by ${platformLabel(g.platform)}` : "No numbers yet";
}

export const viewShareCell = (g: Pick<FormatGroup, "viewShare" | "platform">) => (g.viewShare === null ? `Views not provided by ${platformLabel(g.platform)}` : `${g.viewShare}% of ${platformLabel(g.platform)} views`);

const evidenceValue = (e: Evidence, v: number) => (e.unit === "count" ? formatMetric(e.metric, v) : e.unit === "percent" ? formatMetric("engagementRate", v) : `index ${v}`);

/** "Median 1.2K views vs 800 before, 6 posts, Last 28 days". Topic evidence is an index where 100 is your usual. */
export function evidenceLine(e: Evidence): string {
  const metric = METRIC_LABEL[e.metric].toLowerCase();
  const base = e.unit === "index" ? `vs 100 for your usual posts (${plural(e.baselineN, "post")})` : `vs ${evidenceValue(e, e.baseline)} across the ${plural(e.baselineN, "post")} before`;
  return `Median ${evidenceValue(e, e.value)} ${metric} ${base}, ${plural(e.n, "post")}, ${e.period}`;
}

export const liftWord = (lift: number) => `${lift >= 0 ? "Up" : "Down"} ${Math.round(Math.abs(lift))}%`;

export function confidenceNote(posts: number): { level: Confidence; text: string } {
  const level = confidenceOf(posts);
  return { level, text: `${CONFIDENCE_WORD[level]} overall from ${plural(posts, "post")}. Low under 5 posts, medium under 12, high from 12, and each card shows its own.` };
}

export const hasEnoughPosts = (posts: number) => posts >= MIN_SAMPLE;

/** The honest empty state: what is missing, in numbers. */
export function emptyStateText(posts: number, days: number): string {
  const need = MIN_SAMPLE - Math.max(0, posts);
  return `Outlly needs at least ${MIN_SAMPLE} published posts with numbers in the last ${days} days to compare anything, and you have ${posts}. Publish ${plural(need, "more post")} on Instagram, YouTube or Facebook (the platforms that give Outlly per-post numbers), or pick a longer window.`;
}

export const workingEmptyText = `Nothing is clearly ahead yet. A format counts as working when its median is at least ${SIGNAL_MIN_LIFT}% above the period before, with ${MIN_SAMPLE} or more posts on each side.`;
export const attentionEmptyText = `Nothing is clearly behind. A format needs attention when its median is at least ${SIGNAL_MIN_LIFT}% below the period before, with ${MIN_SAMPLE} or more posts on each side.`;

/** Groups by platform in the engine's order, so the comparison never mixes two platforms' numbers. */
export function byPlatform(formats: FormatGroup[]): { platform: string; groups: FormatGroup[] }[] {
  const out: { platform: string; groups: FormatGroup[] }[] = [];
  for (const g of formats) {
    const last = out.find((x) => x.platform === g.platform);
    if (last) last.groups.push(g);
    else out.push({ platform: g.platform, groups: [g] });
  }
  return out;
}

/** The ranked groups' best posts, each kept with its own group: a carousel is never ranked against a video. */
export function bestGroups(formats: FormatGroup[]): { key: string; platform: string; format: string; metric: MetricKey; top: FormatGroup["top"] }[] {
  return formats
    .filter((g): g is FormatGroup & { primary: MetricKey } => g.status === "ok" && g.primary !== null && g.top.length > 0)
    .map((g) => ({ key: `${g.platform}|${g.format}`, platform: g.platform, format: g.format, metric: g.primary, top: g.top }));
}

export const createHref = (id: string | null | undefined) => (id ? `/create?rec=${encodeURIComponent(id)}` : null);

export function overviewUrl(days: number, objective: string | null, account: string | null): string {
  const q = new URLSearchParams({ days: String(days) });
  if (objective) q.set("objective", objective);
  if (account) q.set("account", account);
  return `/api/intelligence/overview?${q.toString()}`;
}
