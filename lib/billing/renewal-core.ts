/**
 * 1096: renewal reminders. Pure, so the daily cron and the tests agree on who gets which email when.
 *
 * Without auto-renew: a reminder 7 days and again 1 day before access ends. With auto-renew: one heads-up
 * 3 days before the charge. `remindedFor` remembers the last one sent ("<periodEnd ms>:<step>"), so the cron
 * can run as often as it likes and nobody gets the same email twice.
 */
export type ReminderStep = "7d" | "1d" | "charge-3d";

const DAY = 86_400_000;

export function reminderDue(
  sub: { status: string; autoRenew: boolean; currentPeriodEnd: Date; remindedFor: string | null; cancelAtPeriodEnd?: boolean },
  now = new Date(),
): ReminderStep | null {
  if (sub.status !== "active" || sub.cancelAtPeriodEnd) return null; // they chose to leave: the cancel email said when
  const left = sub.currentPeriodEnd.getTime() - now.getTime();
  if (left <= 0) return null;
  const key = (s: ReminderStep) => `${sub.currentPeriodEnd.getTime()}:${s}`;
  const sent = (s: ReminderStep) => sub.remindedFor === key(s);
  if (sub.autoRenew) return left <= 3 * DAY && !sent("charge-3d") ? "charge-3d" : null;
  if (left <= DAY) return sent("1d") ? null : "1d";
  if (left <= 7 * DAY) return sent("7d") || sent("1d") ? null : "7d";
  return null;
}

export const reminderKey = (periodEnd: Date, step: ReminderStep) => `${periodEnd.getTime()}:${step}`;

/**
 * Where a renewed period ends. A charge that lands a little late (the gateway retries for a few days) still
 * continues from the old end, so nobody loses days; one that lands long after the plan lapsed starts today.
 */
export function renewedEnd(currentEnd: Date, interval: string, now = new Date(), graceDays = 7) {
  const from = currentEnd.getTime() >= now.getTime() - graceDays * DAY ? currentEnd : now;
  const d = new Date(from);
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}
