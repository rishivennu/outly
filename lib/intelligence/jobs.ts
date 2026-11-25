import "server-only";
import { db } from "../db";
import { errorText, INTELLIGENCE_JOB_RETENTION_DAYS, JOB_WINDOW_DAYS, LATENCY_WINDOW_DAYS, predictLatency, sumPersonalRuns, summarizeRuns, type IntelligenceJob, type JobStat, type JobTrigger } from "./jobs-core";

export type { IntelligenceJob, JobStat, JobTrigger } from "./jobs-core";

/**
 * R1337: the Intelligence job log. Every run of the personal sweep step, every shared rebuild and every on-demand draft
 * forecast leaves one IntelligenceJobRun row (ok or not, how long, what it counted), so Admin > AI Management can show
 * success rates and latency that were measured, not assumed. Recording never throws: a log that broke the job it logs
 * would be worse than no log.
 */
export async function recordJobRun(job: IntelligenceJob, input: { trigger?: JobTrigger; startedAt: number | Date; ok: boolean; result?: unknown; error?: unknown; now?: number | Date }): Promise<boolean> {
  const started = input.startedAt instanceof Date ? input.startedAt.getTime() : input.startedAt;
  const finished = input.now instanceof Date ? input.now.getTime() : (input.now ?? Date.now());
  try {
    await db.intelligenceJobRun.create({
      data: {
        job,
        trigger: input.trigger ?? "sweep",
        ok: input.ok,
        durationMs: Math.max(0, Math.round(finished - started)),
        result: input.result === undefined || input.result === null ? null : JSON.stringify(input.result).slice(0, 2000),
        error: input.ok ? null : errorText(input.error),
        startedAt: new Date(started),
        finishedAt: new Date(finished),
      },
    });
    return true;
  } catch (e) {
    console.error("[intel] job log", job, e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Run `fn` and log it. A thrown error is logged as a failed run and rethrown, so the caller's own handling stands.
 * `skip` (optional) says a result was "nothing to do" (the shared sweep's hourly clock not being due) and should not
 * leave a row; a job that did real work always does.
 */
export async function runJob<T>(job: IntelligenceJob, trigger: JobTrigger, fn: () => Promise<T>, opts: { skip?: (r: T) => boolean; summary?: (r: T) => unknown; now?: number | Date } = {}): Promise<T> {
  const startedAt = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  try {
    const r = await fn();
    if (!(opts.skip && opts.skip(r))) await recordJobRun(job, { trigger, startedAt, ok: true, result: opts.summary ? opts.summary(r) : r });
    return r;
  } catch (e) {
    await recordJobRun(job, { trigger, startedAt, ok: false, error: e });
    throw e;
  }
}

/** Housekeeping: rows past the retention window go. */
export async function pruneJobRuns(now: Date = new Date()): Promise<number> {
  const r = await db.intelligenceJobRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - INTELLIGENCE_JOB_RETENTION_DAYS * 864e5) } } });
  return r.count;
}

export interface JobsSummary {
  windowDays: number;
  latencyWindowDays: number;
  retentionDays: number;
  jobs: JobStat[];
  personal: { runs: number; withWork: number; owners: number; features: number; failedOwners: number; skipped: number };
  /** Null until a draft forecast has been asked for in the latency window: shown as "not measured yet", never a guess. */
  predict: { n: number; p50: number; p95: number; failed: number } | null;
  oldestRowAt: string | null;
}

export async function jobsSummary(now: Date = new Date()): Promise<JobsSummary> {
  const since = new Date(now.getTime() - JOB_WINDOW_DAYS * 864e5);
  const [rows, oldest] = await Promise.all([
    db.intelligenceJobRun.findMany({ where: { startedAt: { gte: since } }, select: { job: true, ok: true, durationMs: true, startedAt: true, error: true, result: true }, orderBy: { startedAt: "desc" }, take: 20_000 }),
    db.intelligenceJobRun.findFirst({ orderBy: { startedAt: "asc" }, select: { startedAt: true } }),
  ]);
  const latencySince = now.getTime() - LATENCY_WINDOW_DAYS * 864e5;
  return {
    windowDays: JOB_WINDOW_DAYS,
    latencyWindowDays: LATENCY_WINDOW_DAYS,
    retentionDays: INTELLIGENCE_JOB_RETENTION_DAYS,
    jobs: summarizeRuns(rows),
    personal: sumPersonalRuns(rows),
    predict: predictLatency(rows.filter((r) => r.startedAt.getTime() >= latencySince)),
    oldestRowAt: oldest ? oldest.startedAt.toISOString() : null,
  };
}
