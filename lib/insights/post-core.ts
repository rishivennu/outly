/** 1088: shared by the insights server code, the popup and the tests. No server imports here. */

export type MetricKey = "views" | "reach" | "impressions" | "likes" | "comments" | "shares" | "saves" | "engagementRate" | "watchTimeMin" | "avgWatchSec";

export interface TargetInsights {
  targetId: string;
  platform: string;
  accountName: string | null;
  url: string | null;
  publishedAt: string | null;
  /** live = fetched from the platform just now (see fetchedAt). Everything else carries a message instead of numbers. */
  status: "live" | "not_published" | "removed" | "practice" | "unavailable" | "error";
  metrics: Partial<Record<MetricKey, number>>;
  /** Metrics this platform did not return for this post. Shown as "Not available", never as 0. */
  unavailable: MetricKey[];
  supported?: MetricKey[];
  notes: string[];
  fetchedAt: string | null;
  message: string | null;
  code?: string;
}

export interface PostInsights {
  postId: string;
  fetchedAt: string;
  targets: TargetInsights[];
}

/** Interactions over the base (reach or views), as a percentage. Null when there is nothing honest to divide by. */
export function engagementRate(m: Partial<Record<MetricKey, number>>, by: "reach" | "views"): number | null {
  const base = m[by];
  if (base === undefined || base <= 0) return null;
  const parts = [m.likes, m.comments, m.shares, m.saves].filter((x): x is number => typeof x === "number");
  if (!parts.length) return null;
  return Math.round((parts.reduce((a, b) => a + b, 0) / base) * 10_000) / 100;
}

/** Says exactly what engagementRate divided, from the metrics this answer actually had. */
export function engagementNote(m: Partial<Record<MetricKey, number>>, by: "reach" | "views"): string | null {
  if (m.engagementRate === undefined) return null;
  const names = (["likes", "comments", "shares", "saves"] as const).filter((k) => typeof m[k] === "number");
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `Engagement rate = ${list} divided by ${by}.`;
}

export const METRIC_LABEL: Record<MetricKey, string> = {
  views: "Views",
  reach: "Reach",
  impressions: "Impressions",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  engagementRate: "Engagement rate",
  watchTimeMin: "Watch time",
  avgWatchSec: "Avg. watch",
};

export const METRIC_ORDER: MetricKey[] = ["views", "reach", "likes", "comments", "shares", "saves", "engagementRate", "watchTimeMin", "avgWatchSec", "impressions"];

export function formatMetric(k: MetricKey, v: number): string {
  if (k === "engagementRate") return `${v.toFixed(v >= 10 ? 1 : 2)}%`;
  if (k === "avgWatchSec") return v >= 60 ? `${Math.floor(v / 60)}m ${Math.round(v % 60)}s` : `${v.toFixed(v >= 10 ? 0 : 1)}s`;
  if (k === "watchTimeMin") return v >= 120 ? `${(v / 60).toFixed(1)} h` : `${Math.round(v)} min`;
  return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v));
}

/** "just now", "3 min ago", "2 h ago". */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
