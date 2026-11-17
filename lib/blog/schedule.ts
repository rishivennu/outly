import "server-only";
import { db } from "../db";
import { env } from "../env";
import { getConfig } from "../settings";
import { adminEvent } from "../admin/route";
import type { BlogConfig } from "./config";
import { JobError, localDay, localMinutes, runStage, startJob } from "./job";
import { blogReady } from "./llm";
import { publishDue } from "./posts";

/**
 * R1178 blog scheduler. Serverless has nothing always-on, so the minute sweep (an external pinger) calls
 * kickBlogTick, which only spends a request on /api/cron/blog when something is due; Vercel's daily cron on that
 * route is the backup. One tick runs at most ONE stage: a stage can take ~50 s and the function has 60 s.
 * Nothing here publishes a generated draft: publishDue only publishes what a person approved for a date.
 */

/** A run nobody drives: the generate page keeps updatedAt fresh, a stage killed by a function timeout leaves it stale. */
const STALE_MS = 65_000;
/** A stage needs up to ~50 s; with less budget than this the tick leaves resuming to the next call. */
const STAGE_BUDGET_MS = 50_000;

export const hhmm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export interface BlogTickSummary {
  published: number;
  publishFailed: number;
  paused: boolean;
  started: string | null;
  /** Why no run started this tick ("" when one did). */
  startReason: string;
  resumed: { id: string; stage: string; status: string } | null;
  delayed: string[];
}

type StartCheck = { due: true } | { due: false; reason: string };

/** Step 3's rules, shared by the tick and the cheap pre-check in kickBlogTick. */
async function startDue(cfg: BlogConfig, now: Date): Promise<StartCheck> {
  const today = localDay(cfg.timezone, now);
  if (!cfg.schedule.enabled) return { due: false, reason: "schedule off" };
  if ((cfg.skipDates ?? []).includes(today)) return { due: false, reason: "skipped day" };
  if (localMinutes(cfg.timezone, now) < hhmm(cfg.schedule.startTime)) return { due: false, reason: "before start time" };
  const [scheduled, running] = await Promise.all([db.blogJob.count({ where: { forDate: today, kind: "scheduled" } }), db.blogJob.count({ where: { forDate: today, status: "running" } })]);
  if (scheduled >= Math.max(1, cfg.schedule.perDay)) return { due: false, reason: "already ran today" };
  if (running) return { due: false, reason: "a run is going" };
  if (!blogReady()) return { due: false, reason: "no AI key" };
  return { due: true };
}

/** Running jobs for today past readyBy that have not been reported late yet. */
async function lateJobs(cfg: BlogConfig, now: Date) {
  const today = localDay(cfg.timezone, now);
  if (localMinutes(cfg.timezone, now) < hhmm(cfg.schedule.readyBy)) return [];
  return db.blogJob.findMany({ where: { forDate: today, status: "running", events: { none: { status: "delayed" } } }, orderBy: { startedAt: "asc" }, take: 5 });
}

export async function blogTick(now = new Date(), opts: { budgetMs?: number } = {}): Promise<BlogTickSummary> {
  const out: BlogTickSummary = { published: 0, publishFailed: 0, paused: false, started: null, startReason: "", resumed: null, delayed: [] };
  // 1. Always, even while paused: the date was a person's decision.
  try {
    const r = await publishDue(now);
    out.published = r.published.length;
    out.publishFailed = r.failed.length;
  } catch (e) {
    console.error("[blog-tick]", e);
  }
  const cfg = await getConfig("blog");
  // 2. Paused stops starting AND resuming; a running job just waits.
  if (cfg.paused) {
    out.paused = true;
    out.startReason = "paused";
    return out;
  }
  // 3. Start today's scheduled run, taking the oldest backlog topic as the angle.
  try {
    const check = await startDue(cfg, now);
    if (!check.due) out.startReason = check.reason;
    else {
      const topic = await db.blogTopic.findFirst({ where: { status: "backlog" }, orderBy: { createdAt: "asc" } });
      const hint = topic ? topic.topic + (topic.problem ? ": " + topic.problem : "") : undefined;
      try {
        const { job, existed } = await startJob({ kind: "scheduled", by: "schedule", hint, now });
        if (existed) out.startReason = "a run is going";
        else {
          out.started = job.id;
          // Marked only once the run exists, so a refused start does not burn the topic.
          if (topic) await db.blogTopic.updateMany({ where: { id: topic.id, status: "backlog" }, data: { status: "used", chosenAt: now } });
          await adminEvent("blog.started", "The daily blog run started", topic ? `From the backlog: ${topic.topic}` : undefined, "/admin/blog/generate");
        }
      } catch (e) {
        if (!(e instanceof JobError && e.status === 409)) throw e;
        out.startReason = e.message;
      }
    }
  } catch (e) {
    console.error("[blog-tick]", e);
  }
  // 4. Resume: exactly one stage of the run just started, or of the oldest run nobody is driving (restart recovery).
  try {
    if ((opts.budgetMs ?? 55_000) >= STAGE_BUDGET_MS) {
      const id =
        out.started ??
        (await db.blogJob.findFirst({ where: { status: "running", updatedAt: { lt: new Date(now.getTime() - STALE_MS) } }, orderBy: { startedAt: "asc" }, select: { id: true } }))?.id;
      if (id) {
        const v = await runStage(id);
        out.resumed = { id, stage: v.stage, status: v.status };
      }
    }
  } catch (e) {
    console.error("[blog-tick]", e);
  }
  // 5. Late: once per job, say so. Never mark it ready.
  try {
    for (const job of await lateJobs(cfg, now)) {
      const message = `Past ${cfg.schedule.readyBy}, still on ${job.stage}${job.error ? ": " + job.error : ""}`.slice(0, 500);
      await db.blogJobEvent.create({ data: { jobId: job.id, stage: job.stage, status: "delayed", message } });
      await adminEvent("blog.delayed", "Today's blog is running late", message, "/admin/blog/generate");
      out.delayed.push(job.id);
    }
  } catch (e) {
    console.error("[blog-tick]", e);
  }
  return out;
}

/** True when a tick would do something. Cheap: a few counts, no model calls. */
export async function blogWorkDue(now = new Date()): Promise<boolean> {
  if (await db.blogPost.count({ where: { status: "approved", scheduledFor: { lte: now } } })) return true;
  const cfg = await getConfig("blog");
  if (cfg.paused) return false;
  if ((await startDue(cfg, now)).due) return true;
  if (await db.blogJob.count({ where: { status: "running", updatedAt: { lt: new Date(now.getTime() - STALE_MS) } } })) return true;
  return (await lateJobs(cfg, now)).length > 0;
}

/**
 * Vercel freezes a function once its response is sent; its request context exposes waitUntil, which keeps the
 * fetch alive (same hook as lib/queue/index.ts). Elsewhere this is a no-op.
 */
function holdOpen(p: Promise<unknown>) {
  try {
    const ctx = (globalThis as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined } | undefined>)[Symbol.for("@vercel/request-context")]?.get?.();
    ctx?.waitUntil?.(p);
  } catch {
    /* not on Vercel */
  }
}

/**
 * Called by the minute sweep. Hands due blog work to /api/cron/blog in its own invocation (own 60 s), so a
 * 50 s stage never eats the sweep's budget. `origin` comes from the sweep request: APP_URL may be unset.
 */
export async function kickBlogTick(origin: string, now = new Date()): Promise<"idle" | "kicked" | "no secret"> {
  if (!env.CRON_SECRET) return "no secret";
  if (!(await blogWorkDue(now))) return "idle";
  const p = fetch(`${origin}/api/cron/blog`, { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}` } })
    .then((r) => r.text())
    .catch((e) => console.error("[blog-tick] kick", e));
  holdOpen(p);
  return "kicked";
}
