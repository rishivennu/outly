import { startSweeper } from "./lib/queue/sweeper";

// With Redis, `bun run worker` owns the queues and the sweeper. Without it, run them in-process for dev.
if (!process.env.REDIS_URL) {
  startSweeper();
  console.log("[studio] in-process queue + scheduler running (set REDIS_URL to use BullMQ workers)");
}
