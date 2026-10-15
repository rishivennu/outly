/**
 * "Pause instead of cancel": the paid days left are frozen, not lost. Pausing pushes the period end
 * out by the length of the pause; resuming early pulls it back by the unused part. Pure, unit-tested.
 */
export const PAUSE_MONTHS = [1, 2, 3] as const;

const addMonths = (d: Date, n: number) => {
  const x = new Date(d.getTime());
  const day = x.getUTCDate();
  x.setUTCMonth(x.getUTCMonth() + n);
  if (x.getUTCDate() < day) x.setUTCDate(0); // 31 Jan + 1 month = 28/29 Feb, not 3 Mar
  return x;
};

export function pausePlan(now: Date, periodEnd: Date, months: number) {
  if (!PAUSE_MONTHS.includes(months as 1)) throw new Error("Pause for 1, 2 or 3 months");
  const pausedUntil = addMonths(now, months);
  const left = Math.max(0, periodEnd.getTime() - now.getTime());
  return { pausedUntil, periodEnd: new Date(pausedUntil.getTime() + left), daysKept: Math.round(left / 864e5) };
}

export function resumePlan(now: Date, pausedUntil: Date, periodEnd: Date) {
  const unused = Math.max(0, pausedUntil.getTime() - now.getTime());
  return { periodEnd: new Date(periodEnd.getTime() - unused) };
}

export const isPaused = (s: { pausedUntil: Date | null }, now = new Date()) => !!s.pausedUntil && s.pausedUntil > now;
