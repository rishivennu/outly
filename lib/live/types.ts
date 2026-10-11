import type { Platform } from "../domain";

export type DashboardStatus = "ok" | "not_connected" | "not_configured" | "needs_reconnect" | "error";

export interface Headline {
  key: string;
  label: string;
  value: number | null;
  /** Percent change against the previous window of the same length. Null when the platform gives no comparison. */
  delta?: number | null;
  format?: "int" | "pct" | "duration";
  hint?: string;
}

export interface Series {
  key: string;
  label: string;
  points: { date: string; value: number }[];
}

export interface LivePost {
  id: string;
  title: string;
  thumb: string | null;
  url: string | null;
  publishedAt: string;
  format: string;
  /** Seconds, when the platform reports it. */
  duration?: number | null;
  views: number | null;
  reach?: number | null;
  likes: number | null;
  comments: number | null;
  shares?: number | null;
  saves?: number | null;
  /** Average watch time in seconds, when reported. */
  avgWatch?: number | null;
  captionLength: number;
  hashtags: number;
}

export interface Suggestion {
  id: string;
  title: string;
  body: string;
  /** The real numbers behind the advice, shown under it so nothing reads as a guess. */
  evidence: string;
  impact: "high" | "medium" | "low";
  action?: { label: string; href: string };
  /** "rules" = worked out from the numbers here; "ai" = written by Gemini from the same numbers. */
  source: "rules" | "ai";
}

export interface PlatformDashboard {
  platform: Platform;
  status: DashboardStatus;
  fetchedAt: string;
  rangeDays: number;
  message?: string;
  /** How this creator can connect the platform from here, when it isn't connected yet. */
  connect?: { oauth: boolean; token: boolean };
  profile?: { name: string; handle: string; avatar: string | null; url: string | null; bio?: string | null };
  headline: Headline[];
  series: Series[];
  /** Followers online by hour of the day, already shifted to the creator's timezone. */
  hours?: { startMinute: number; label: string; value: number }[];
  breakdown?: { title: string; items: { label: string; value: number }[] };
  posts: LivePost[];
  /** Partial failures: one API refused but the rest of the page still loaded. */
  notes: { level: "info" | "warning"; text: string; detail?: string }[];
  suggestions: Suggestion[];
}
