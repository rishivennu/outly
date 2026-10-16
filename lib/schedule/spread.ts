import { zoned } from "./best-time";

/**
 * Spread a batch of posts over the coming days. Pure (no I/O) so it is unit-tested with fixtures.
 * One post a day at the creator's best hour, spaced across the week when there are fewer than seven,
 * never within `gapMin` of something already booked. Only when the days run out do two share a day.
 */
export interface SpreadInput {
  count: number;
  /** Local hours (0-23), strongest first, from bestTimes(). */
  peakHours: number[];
  tz: string;
  now?: Date;
  /** Times already booked (other scheduled posts). */
  taken?: (Date | string)[];
  horizonDays?: number;
  gapMin?: number;
}

const FALLBACK_HOURS = [19, 12, 9];

function localDay(at: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"));
}

export function spreadSlots(input: SpreadInput): string[] {
  const now = input.now ?? new Date();
  const count = Math.max(0, Math.floor(input.count));
  if (!count) return [];
  const hours = [...new Set((input.peakHours.length ? input.peakHours : FALLBACK_HOURS).filter((h) => h >= 0 && h < 24))];
  const horizon = input.horizonDays ?? 21;
  const gap = (input.gapMin ?? 120) * 60_000;
  const booked = (input.taken ?? []).map((t) => +new Date(t)).filter(Number.isFinite);
  const base = localDay(now, input.tz);
  const picked: { t: number; day: number }[] = [];

  const free = (t: number) => t - now.getTime() >= 30 * 60_000 && ![...booked, ...picked.map((p) => p.t)].some((x) => Math.abs(x - t) < gap);
  const slotOn = (day: number) => {
    const d = new Date(base + day * 864e5);
    for (const h of hours) {
      const t = zoned(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, input.tz).getTime();
      if (free(t)) return t;
    }
    return null;
  };
  const perDay = (day: number) => picked.filter((p) => p.day === day).length;
  const take = (day: number, max: number) => {
    if (day < 0 || day >= horizon || perDay(day) >= max) return false;
    const t = slotOn(day);
    if (t === null) return false;
    picked.push({ t, day });
    return true;
  };

  // The first day that still has an open best hour (late at night, today is already gone).
  let first = 0;
  while (first < horizon && slotOn(first) === null) first++;

  // Pass 1: evenly over a week (fewer than 7) or one a day (7 or more). A blocked day slides to the next free one.
  const stride = count < 7 ? 7 / count : 1;
  for (let k = 0; k < count; k++) {
    let day = first + Math.round(k * stride);
    while (day < horizon && !take(day, 1)) day++;
  }
  // Pass 2: any day still empty. Pass 3: a second (third...) post on a day, at its next best hour.
  for (let day = first; day < horizon && picked.length < count; day++) take(day, 1);
  for (let max = 2; max <= hours.length && picked.length < count; max++)
    for (let day = first; day < horizon && picked.length < count; day++) take(day, max);

  return picked
    .slice(0, count)
    .sort((a, b) => a.t - b.t)
    .map((p) => new Date(p.t).toISOString());
}
