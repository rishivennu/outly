/**
 * R1297: which parts of the minute sweep run on a given minute.
 *
 * The sweep is called every minute (Vercel Cron, or an external pinger) and used to run every one of its ~16
 * sub-sweeps each time, so an idle site still paid ~160 ms of CPU a minute, half of the whole deployment's compute.
 * Only the creator-facing steps need the minute: a scheduled post going out, a stuck upload handed back, the
 * notification events (a failed post, a payment failure), push retries, the "goes out in N minutes" reminder.
 * Everything else is housekeeping with its own idempotency window (campaign batches, trial expiry, greetings,
 * digests, storage cleanup, metric sync cooldowns), so it runs on a slot and does exactly the same work, later by
 * at most a few minutes. Slots are spread so no minute carries two heavy steps.
 *
 * The plan is a pure function of the clock so tests can pin it, and `full` (the `?full=1` query, for a manual run
 * after a deploy) runs everything at once.
 */
export type SweepPlan = {
  /** Every minute: due posts, stuck targets, heartbeat, push outbox, reminders, notification events. */
  core: true;
  /** Watchdog health cycle: even minutes. Its 60 s services are checked every 2 minutes, the rest on their own interval. */
  health: boolean;
  /** Analytics background sync: odd minutes (alternates with the health cycle so neither waits on the other). */
  metrics: boolean;
  /** Storage cleanup, abandoned uploads, greetings and digests, partner deadlines, campaigns, comment re-subscribe. */
  housekeeping: boolean;
  /** Blog work kick (its own invocation): every 5 minutes. */
  blog: boolean;
};

export const HOUSEKEEPING_SLOT = 1;
export const BLOG_SLOT = 3;

export function sweepPlan(now: Date, full = false): SweepPlan {
  if (full) return { core: true, health: true, metrics: true, housekeeping: true, blog: true };
  const min = now.getMinutes();
  return {
    core: true,
    health: min % 2 === 0,
    metrics: min % 2 === 1,
    housekeeping: min % 5 === HOUSEKEEPING_SLOT,
    blog: min % 5 === BLOG_SLOT,
  };
}

/** The `?full=1` switch: only a true-ish value counts, so a pinger that appends junk never forces the full run. */
export const wantsFull = (url: URL) => ["1", "true", "yes"].includes(url.searchParams.get("full") ?? "");
