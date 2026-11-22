import "server-only";
import { drainEvents, pruneEvents } from "../notify-engine";
import { sweepAssistant } from "./assistant";
import { sweepDigests } from "./digest";

/**
 * 1141: the notification engine's minute of work, in one call so the sweeper route needs one line.
 * Order matters: decide what to say first, then deliver everything waiting, so a greeting written this
 * minute goes out this minute. Tidying up only runs once an hour, and never blocks the delivery.
 *
 * R1297: `full` is the housekeeping slot (every 5 minutes). Between slots only the event queue drains, every minute,
 * so a failed post or a payment failure never waits; greetings, inactivity nudges, digests and partner deadlines
 * all have idempotency windows of hours, and lose nothing by running on the slot.
 */
export async function sweepNotify(now = new Date(), full = true) {
  const assist = full ? await sweepAssistant(now).catch((e) => (console.error("[notify] assist", e), null)) : null;
  const digests = full ? await sweepDigests(now).catch((e) => (console.error("[notify] digest", e), null)) : null;
  const partners = full ? await import("../partners/notices").then((m) => m.partnerDeadlineSweep(now)).catch((e) => (console.error("[notify] partners", e), null)) : null; // R1289 deliverable deadlines
  const events = await drainEvents(now).catch((e) => (console.error("[notify] drain", e), null));
  const pruned = now.getMinutes() === 23 ? await pruneEvents(now).catch(() => 0) : 0;
  return { assist, digests, partners, events, pruned };
}
