/** Pure: percentiles over stored PerfSample rows for the admin read-out. */
import { PERF_METRICS, type PerfMetric } from "./sample";

export type PerfRow = { at: Date; cold: boolean; installed: boolean; version: string } & Record<PerfMetric, number | null>;
export type Stat = { n: number; p50: number | null; p75: number | null; p95: number | null };
export const SEGMENTS = ["all", "cold", "warm", "installed", "browser"] as const;
export type Segment = (typeof SEGMENTS)[number];

/** Nearest-rank percentile: always a value that was really measured, never an interpolated one. */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

export function stat(values: (number | null | undefined)[]): Stat {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  return { n: v.length, p50: percentile(v, 50), p75: percentile(v, 75), p95: percentile(v, 95) };
}

const IN_SEGMENT: Record<Segment, (r: PerfRow) => boolean> = {
  all: () => true,
  cold: (r) => r.cold,
  warm: (r) => !r.cold,
  installed: (r) => r.installed,
  browser: (r) => !r.installed,
};

export type Summary = { samples: Record<Segment, number>; metrics: Record<PerfMetric, Record<Segment, Stat>> };

export function summarize(rows: PerfRow[], since?: Date): Summary {
  const inRange = since ? rows.filter((r) => r.at >= since) : rows;
  const by = Object.fromEntries(SEGMENTS.map((s) => [s, inRange.filter(IN_SEGMENT[s])])) as Record<Segment, PerfRow[]>;
  const metrics = Object.fromEntries(
    PERF_METRICS.map((m) => [m, Object.fromEntries(SEGMENTS.map((s) => [s, stat(by[s].map((r) => r[m]))]))]),
  ) as Summary["metrics"];
  return { samples: Object.fromEntries(SEGMENTS.map((s) => [s, by[s].length])) as Record<Segment, number>, metrics };
}

export type VersionRow = { version: string; samples: number; first: Date; last: Date; p75: Record<PerfMetric, number | null> };

/** One row per app version, newest first, so a before/after comparison reads top to bottom. */
export function byVersion(rows: PerfRow[], limit = 12): VersionRow[] {
  const groups = new Map<string, PerfRow[]>();
  for (const r of rows) {
    const list = groups.get(r.version);
    if (list) list.push(r);
    else groups.set(r.version, [r]);
  }
  return [...groups]
    .map(([version, list]) => {
      let first = Infinity;
      let last = -Infinity;
      for (const r of list) {
        first = Math.min(first, r.at.getTime());
        last = Math.max(last, r.at.getTime());
      }
      return {
        version,
        samples: list.length,
        first: new Date(first),
        last: new Date(last),
        p75: Object.fromEntries(PERF_METRICS.map((m) => [m, stat(list.map((r) => r[m])).p75])) as VersionRow["p75"],
      };
    })
    .sort((a, b) => b.last.getTime() - a.last.getTime())
    .slice(0, limit);
}

/* R1230: budgets (web.dev "good" / "poor" thresholds, p75). CLS is stored x1000. Startup marks of our own
   (hydrate, content) and the server legs (mwMs, userMs, cfgMs) have no public threshold: no verdict for them. */
export const BUDGET: Partial<Record<PerfMetric, { good: number; poor: number }>> = {
  ttfb: { good: 800, poor: 1800 },
  fcp: { good: 1800, poor: 3000 },
  lcp: { good: 2500, poor: 4000 },
  cls: { good: 100, poor: 250 },
  inp: { good: 200, poor: 500 },
};
export type Verdict = "good" | "needs work" | "poor";
/** Where a p75 sits against its budget; null when the metric has no budget or no samples. */
export function verdict(m: PerfMetric, p75: number | null): Verdict | null {
  const b = BUDGET[m];
  if (!b || p75 == null) return null;
  return p75 <= b.good ? "good" : p75 > b.poor ? "poor" : "needs work";
}
/** Which metrics of a version sit over their budget (p75 beyond "good"), so a regression reads as a short list. */
export function overBudget(p75: Partial<Record<PerfMetric, number | null>>): PerfMetric[] {
  return PERF_METRICS.filter((m) => {
    const v = verdict(m, p75[m] ?? null);
    return v === "needs work" || v === "poor";
  });
}

/** 840 -> "840 ms", 1240 -> "1.24 s"; CLS is stored x1000, so 92 -> "0.092". */
export function fmtMetric(m: PerfMetric, v: number | null): string {
  if (v == null) return "-";
  if (m === "cls") return (v / 1000).toFixed(3);
  return v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(2)} s`;
}
