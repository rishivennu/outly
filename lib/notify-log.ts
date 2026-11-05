import "server-only";
import { db } from "./db";
import { centreTabOf, type Delivery, type SkipReason } from "./notify-core";

/**
 * 1141: the delivery log. One row per channel per notification, including the ones that did NOT go out and
 * why ("switched off", "quiet hours", "cooldown", "paused", "no device"). That is the whole point: without
 * the skips, "I never got told" has no answer, and the admin's delivery stats would only ever show success.
 *
 * Best effort by design: a log write must never stop or delay the notification it describes.
 */
export type Channel = "inapp" | "push" | "email" | "fcm";
export type DeliveryStatus = "sent" | "skipped" | "failed" | "queued";

export interface DeliveryRow {
  channel: Channel;
  status: DeliveryStatus;
  reason?: SkipReason | string | null;
  detail?: string | null;
}

export async function logDeliveries(userId: string, kind: string, rows: DeliveryRow[], opts: { eventId?: string | null; noticeId?: string | null } = {}) {
  if (!rows.length) return 0;
  const category = centreTabOf(kind);
  try {
    const r = await db.notifyDelivery.createMany({
      data: rows.map((d) => ({
        userId,
        eventId: opts.eventId ?? null,
        noticeId: opts.noticeId ?? null,
        kind,
        category,
        channel: d.channel,
        status: d.status,
        reason: d.reason ?? null,
        detail: d.detail ? String(d.detail).slice(0, 500) : null,
      })),
    });
    return r.count;
  } catch (e) {
    console.error("[notify-log]", e instanceof Error ? e.message : e);
    return 0;
  }
}

/**
 * What a decision means for each channel, before anything is attempted. The push and email rows are
 * rewritten afterwards with what really happened, so a "sent" row here is only ever written for the bell,
 * which cannot fail once the notice row exists.
 */
export function plannedRows(d: Delivery): DeliveryRow[] {
  if (!d.wanted) return [{ channel: "inapp", status: "skipped", reason: d.reason ?? "event_off" }];
  const rows: DeliveryRow[] = [{ channel: "inapp", status: d.bell ? "sent" : "skipped", reason: d.bell ? null : "inapp_off" }];
  if (!d.push) rows.push({ channel: "push", status: "skipped", reason: d.reason ?? "push_off" });
  if (!d.email) rows.push({ channel: "email", status: "skipped", reason: d.paused ? "paused" : "email_off" });
  return rows;
}

/** Counts for the admin console: how each channel did over a window. */
export async function deliveryStats(sinceDays = 7) {
  const since = new Date(Date.now() - sinceDays * 864e5);
  const rows = await db.notifyDelivery.groupBy({ by: ["channel", "status"], where: { createdAt: { gte: since } }, _count: { _all: true } });
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) (out[r.channel] ??= {})[r.status] = r._count._all;
  return out;
}
