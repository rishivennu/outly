import "server-only";
import { env } from "../env";
import { queueFor, type JobName, type JobPayloads } from "./jobs";

type Opts = { delayMs?: number; jobId?: string };
type Runner = <N extends JobName>(name: N, data: JobPayloads[N]) => Promise<void>;

interface Backend {
  add<N extends JobName>(name: N, data: JobPayloads[N], opts?: Opts): Promise<void>;
}

const g = globalThis as unknown as { __queueBackend?: Backend; __inproc?: { runner?: Runner; pending: Set<string> } };

/** Dev backend: same contract as BullMQ, executed inside the Next.js server process. */
function inProcess(): Backend {
  const state = (g.__inproc ??= { pending: new Set() });
  return {
    async add(name, data, opts) {
      if (opts?.jobId) {
        if (state.pending.has(opts.jobId)) return; // de-dupe like BullMQ jobId
        state.pending.add(opts.jobId);
      }
      setTimeout(async () => {
        if (opts?.jobId) state.pending.delete(opts.jobId);
        try {
          if (!state.runner) state.runner = (await import("./handlers")).runJob;
          await state.runner(name, data);
        } catch (e) {
          console.error(`[queue:inproc] ${name} crashed`, e);
        }
      }, opts?.delayMs ?? 0);
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
