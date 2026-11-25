/**
 * R1337: pure rules for the Intelligence job log (IntelligenceJobRun), shared by the server and the tests. A "job" is
 * one unit of engine work the admin page reports on: the personal sweep step, a shared-model rebuild, an on-demand
 * draft forecast. Nothing here knows a creator: the rows carry counts and timings only.
 */
export const INTELLIGENCE_JOBS = ["personal", "shared", "predict"] as const;
export type IntelligenceJob = (typeof INTELLIGENCE_JOBS)[number];
export type JobTrigger = "sweep" | "admin" | "api";

/** Rows older than this are pruned by the sweep; the admin page reads 30 days, so nothing it shows is ever missing. */
export const INTELLIGENCE_JOB_RETENTION_DAYS = 30;
/** How far back the admin page looks for job rates. */
export const JOB_WINDOW_DAYS = 30;
/** Latency is read over a shorter window, so a slow week is visible as a change, not averaged away. */
export const LATENCY_WINDOW_DAYS = 7;

export const JOB_LABEL: Record<IntelligenceJob, string> = {
  personal: "Personal profiles (sweep step)",
  shared: "Shared model rebuild",
  predict: "Draft forecast (on demand)",
};

export interface JobRunRow {
  job: string;
  ok: boolean;
  durationMs: number;
  startedAt: Date | string;
  error?: string | null;
  result?: string | null;
}

export interface JobStat {
  job: IntelligenceJob;
  label: string;
  runs: number;
  failed: number;
  /** Percent of runs that finished, null with no run in the window. */
  successRate: number | null;
  lastAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  /** Milliseconds; null with no run in the window. */
  durationMs: { p50: number; p95: number; max: number } | null;
}

/** Nearest-rank percentile of an ascending list; 0 for an empty one. */
export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

/** One line per job, counted over the rows given (the caller picks the window). */
export function summarizeRuns(rows: readonly JobRunRow[]): JobStat[] {
  return INTELLIGENCE_JOBS.map((job) => {
    const mine = rows.filter((r) => r.job === job).sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    const last = mine[mine.length - 1];
    const failed = mine.filter((r) => !r.ok).length;
    const durations = mine.map((r) => r.durationMs).sort((a, b) => a - b);
    return {
      job,
      label: JOB_LABEL[job],
      runs: mine.length,
      failed,
      successRate: mine.length ? Math.round(((mine.length - failed) / mine.length) * 1000) / 10 : null,
      lastAt: last ? new Date(last.startedAt).toISOString() : null,
      lastOk: last ? last.ok : null,
      lastError: last && !last.ok ? (last.error ?? null) : null,
      durationMs: durations.length ? { p50: percentile(durations, 50), p95: percentile(durations, 95), max: durations[durations.length - 1] } : null,
    };
  });
}

/** What the personal sweep step did over its runs: the sums of the counters it returns. */
export function sumPersonalRuns(rows: readonly JobRunRow[]): { runs: number; withWork: number; owners: number; features: number; failedOwners: number; skipped: number } {
  const out = { runs: 0, withWork: 0, owners: 0, features: 0, failedOwners: 0, skipped: 0 };
  for (const r of rows) {
    if (r.job !== "personal") continue;
    out.runs++;
    const d = parseResult(r.result);
    const owners = num(d.owners);
    if (owners > 0) out.withWork++;
    out.owners += owners;
    out.features += num(d.features);
    out.failedOwners += num(d.failed);
    out.skipped += num(d.skipped);
  }
  return out;
}

/** Latency of the on-demand forecasts: how long a creator waited for a draft estimate. */
export function predictLatency(rows: readonly JobRunRow[]): { n: number; p50: number; p95: number; failed: number } | null {
  const mine = rows.filter((r) => r.job === "predict");
  if (!mine.length) return null;
  const d = mine.map((r) => r.durationMs).sort((a, b) => a - b);
  return { n: mine.length, p50: percentile(d, 50), p95: percentile(d, 95), failed: mine.filter((r) => !r.ok).length };
}

/** Values a database error message can carry that must not reach the admin log: addresses, Prisma cuids, UUIDs. */
const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  [/\bc[a-z0-9]{24}\b/g, "[id]"],
];

/**
 * The failure text kept on a row: the message only, one line, cut short, never a stack (which could carry a path),
 * with addresses and record ids redacted (a constraint error can quote the offending value).
 */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error";
  const flat = REDACTIONS.reduce((t, [re, to]) => t.replace(re, to), msg.replace(/\s+/g, " ").trim());
  return flat.slice(0, 500) || "Unknown error";
}

export function parseResult(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
