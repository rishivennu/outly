/** Pure helpers for the Home "This week" pulse. No DB, so they are unit tested directly. */

/** Week-over-week change, rounded. null when there is nothing to compare against. */
export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

export interface StripDay {
  key: string; // YYYY-MM-DD in the creator's zone
  label: string; // Mon..Sun
  date: number; // day of month
  isToday: boolean;
  isPast: boolean;
  published: number;
  scheduled: number;
}

const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/**
 * Seven days starting at `monday` (already the local Monday 00:00 instant), with how many posts went
 * out and how many are lined up on each. Days are bucketed in the creator's own time zone.
 */
export function weekStrip(monday: Date, now: Date, tz: string, published: Date[], scheduled: Date[]): StripDay[] {
  const today = ymd(now, tz);
  const count = (list: Date[]) => {
    const m = new Map<string, number>();
    for (const d of list) m.set(ymd(d, tz), (m.get(ymd(d, tz)) ?? 0) + 1);
    return m;
  };
  const pub = count(published);
  const sch = count(scheduled);
  return Array.from({ length: 7 }, (_, i) => {
    const at = new Date(monday.getTime() + i * 864e5 + 12 * 36e5); // noon: safe across DST shifts
    const key = ymd(at, tz);
    return {
      key,
      label: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(at),
      date: Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric" }).format(at)),
      isToday: key === today,
      isPast: key < today,
      published: pub.get(key) ?? 0,
      scheduled: sch.get(key) ?? 0,
    };
  });
}

/** 12,400 -> "12.4K". Keeps small numbers exact. */
export function compact(n: number) {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${+(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`;
  return `${+(n / 1e6).toFixed(1)}M`;
}
