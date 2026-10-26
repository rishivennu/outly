import { startSweeper } from "./lib/queue/sweeper";

// A promise nobody awaited, or a throw outside any request, would otherwise vanish without a trace.
const tagged = globalThis as { __outllyErrHooks?: boolean };
if (!tagged.__outllyErrHooks) {
  tagged.__outllyErrHooks = true;
  // Name, message and stack only (never the raw object: SDK errors can carry keys or signed URLs in their
  // config/cause), with anything that looks like a secret masked.
  const safe = (e: unknown) => {
    const text = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : String(e);
    return text
      .replace(/(bearer\s+)[\w.\-~+/]+=*/gi, "$1[redacted]")
      .replace(/((?:key|token|secret|password|signature|x-amz-[a-z-]+)=)[^&\s"']+/gi, "$1[redacted]")
      .replace(/\b(sk|pk|re|rk)_[A-Za-z0-9_]{12,}/g, "[redacted]")
      .slice(0, 4000);
  };
  process.on("unhandledRejection", (reason) => console.error("[unhandled-rejection]", safe(reason)));
  process.on("uncaughtExceptionMonitor", (err, origin) => console.error("[uncaught-exception]", origin, safe(err)));
}

// With Redis, `bun run worker` owns the queues and the sweeper. Without it, run them in-process for dev.
if (!process.env.REDIS_URL) {
  startSweeper();
  console.log("[studio] in-process queue + scheduler running (set REDIS_URL to use BullMQ workers)");
}
