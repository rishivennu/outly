import "server-only";
import { drainEvents, pruneEvents } from "../notify-engine";
import { sweepAssistant } from "./assistant";
import { sweepDigests } from "./digest";

/**
 * 1141: the notification engine's minute of work, in one call so the sweeper route needs one line.
 * Order matters: decide what to say first, then deliver everything waiting, so a greeting written this
 * minute goes out this minute. Tidying up only runs once an hour, and never blocks the delivery.
 */
export async function sweepNotify(now = new Date()) {
  const assist = await sweepAssistant(now).catch((e) => (console.error("[notify] assist", e), null));
  const digests = await sweepDigests(now).catch((e) => (console.error("[notify] digest", e), null));
  const events = await drainEvents(now).catch((e) => (console.error("[notify] drain", e), null));
  const pruned = now.getMinutes() === 23 ? await pruneEvents(now).catch(() => 0) : 0;
  return { assist, digests, events, pruned };
}
