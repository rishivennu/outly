/**
 * Standalone BullMQ workers: `REDIS_URL=redis://... bun run worker`
 * One Worker per queue → Instagram / YouTube / X progress independently.
 */
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { QUEUE_NAMES, type JobName } from "../lib/queue/jobs";
import { requeueStuckTargets, runJob, sweepDuePosts } from "../lib/queue/handlers";
import { recordSweep } from "../lib/queue/health";

const url = process.env.REDIS_URL;
if (!url) throw new Error("REDIS_URL is required for the worker process");
const connection = new IORedis(url, { maxRetriesPerRequest: null });

const concurrency: Record<string, number> = { media: 2, system: 4, "social-instagram": 3, "social-youtube": 2, "social-x": 4 };

for (const q of QUEUE_NAMES) {
  const w = new Worker(q, async (job) => runJob(job.name as JobName, job.data), { connection, concurrency: concurrency[q] ?? 2 });
  w.on("failed", (job, err) => console.error(`[${q}] ${job?.name} failed`, err));
  console.log(`[worker] listening on ${q}`);
}

// Due posts plus lost-work recovery (which the worker never ran before 1028), and a heartbeat for the admin panel.
const sweep = async () => {
  await sweepDuePosts();
  await requeueStuckTargets();
  await recordSweep("worker");
};
setInterval(() => sweep().catch((e) => console.error("[sweeper]", e)), 15_000);
