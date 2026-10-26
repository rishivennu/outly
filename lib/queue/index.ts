import "server-only";
import { env } from "../env";
import { queueFor, type JobName, type JobPayloads } from "./jobs";

type Opts = { delayMs?: number; jobId?: string };
type Runner = <N extends JobName>(name: N, data: JobPayloads[N]) => Promise<void>;

interface Backend {
  add<N extends JobName>(name: N, data: JobPayloads[N], opts?: Opts): Promise<void>;
}

const g = globalThis as unknown as { __queueBackend?: Backend; __inproc?: { runner?: Runner; pending: Set<string>; live?: Set<Promise<void>> } };

/** Jobs longer away than this aren't held open on serverless: the cron sweeper picks them up instead. */
const HOLD_MAX_DELAY_MS = 45_000;

/**
 * Vercel freezes a function once its response is sent, which kills a plain setTimeout. Its request
 * context exposes waitUntil (what @vercel/functions wraps), so in-process jobs keep the function alive
 * until they finish, up to the route's maxDuration. Elsewhere this is a no-op.
 */
function holdOpen(p: Promise<void>) {
  try {
    const ctx = (globalThis as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined } | undefined>)[Symbol.for("@vercel/request-context")]?.get?.();
    ctx?.waitUntil?.(p);
  } catch {
    /* not on Vercel */
  }
}

/** Dev backend: same contract as BullMQ, executed inside the Next.js server process. */
function inProcess(): Backend {
  const state = (g.__inproc ??= { pending: new Set() });
  const live = (state.live ??= new Set());
  return {
    async add(name, data, opts) {
      if (opts?.jobId) {
        if (state.pending.has(opts.jobId)) return; // de-dupe like BullMQ jobId
        state.pending.add(opts.jobId);
      }
      const delay = opts?.delayMs ?? 0;
      const job = new Promise<void>((resolve) =>
        setTimeout(async () => {
          if (opts?.jobId) state.pending.delete(opts.jobId);
          try {
            if (!state.runner) state.runner = (await import("./handlers")).runJob;
            await state.runner(name, data);
          } catch (e) {
            console.error(`[queue:inproc] ${name} crashed`, e);
          } finally {
            resolve();
          }
        }, delay),
      );
      live.add(job);
      void job.then(() => live.delete(job));
      if (delay <= HOLD_MAX_DELAY_MS) holdOpen(job);
    },
  };
}

function bull(): Backend {
  // Lazy so dev without Redis never loads ioredis.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Queue } = require("bullmq") as typeof import("bullmq");
  const IORedis = require("ioredis") as typeof import("ioredis").default;
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queues = new Map<string, InstanceType<typeof Queue>>();
  return {
    async add(name, data, opts) {
      const qn = queueFor(name, data);
      let q = queues.get(qn);
      if (!q) queues.set(qn, (q = new Queue(qn, { connection })));
      await q.add(name, data, {
        delay: opts?.delayMs,
        jobId: opts?.jobId,
        removeOnComplete: 500,
        removeOnFail: 1000,
      });
    },
  };
}

export function usingRedis() {
  return !!env.REDIS_URL;
}

export function enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts?: Opts) {
  g.__queueBackend ??= usingRedis() ? bull() : inProcess();
  return g.__queueBackend.add(name, data, opts);
}

/**
 * Wait (up to budgetMs) for in-process jobs to finish, including the ones they enqueue next. The cron
 * sweeper calls this so the work it hands out actually runs inside that invocation. Redis: no-op.
 */
export async function settle(budgetMs: number) {
  const live = g.__inproc?.live;
  if (usingRedis() || !live) return 0;
  const deadline = Date.now() + budgetMs;
  while (live.size && Date.now() < deadline) {
    const left = deadline - Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled([...live]), new Promise((r) => (timer = setTimeout(r, left)))]);
    clearTimeout(timer);
  }
  return live.size;
}
