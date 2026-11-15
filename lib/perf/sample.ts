/** Client-safe: shared by the beacon, the /api/perf route and the admin read-out. No zod here, it stays off the client. */

export const PERF_MAX_BYTES = 2048;
/** Anything slower than this is a tab left in the background, not a startup: dropped, never stored. */
export const PERF_MAX_MS = 120_000;
export const PERF_KEEP_DAYS = 30;
export const PERF_WARM_KEY = "outly:warm";
export const HOME_CONTENT_MARK = "outly:home-content";

export const PERF_METRICS = ["ttfb", "fcp", "lcp", "cls", "inp", "hydrate", "content", "mwMs", "userMs", "cfgMs"] as const;
export type PerfMetric = (typeof PERF_METRICS)[number];

/** What one page load sends. Every timing is whole ms since navigation start; CLS is the score x1000. */
export type PerfPayload = {
  id: string;
  path: string;
  cold: boolean;
  installed: boolean;
  version?: string;
  flags?: string;
  device?: string;
  net?: string;
} & Partial<Record<PerfMetric, number | null>>;

export const METRIC_LABEL: Record<PerfMetric, string> = {
  ttfb: "First byte",
  fcp: "First paint",
  lcp: "Largest paint",
  cls: "Layout shift",
  inp: "Input delay",
  hydrate: "Hydrated",
  content: "Home content",
  mwMs: "Middleware",
  userMs: "Session lookup",
  cfgMs: "Layout settings",
};
