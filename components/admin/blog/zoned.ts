/**
 * R1178: wall-clock maths in the blog timezone with plain Intl (no date library). Shared by the review desk,
 * the calendar and the history table, and safe to import from server pages (no "use client").
 */
type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(timeZone: string) {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(timeZone, f);
  }
  return f;
}
function wallParts(t: number, timeZone: string): Parts {
  const out: Record<string, number> = {};
  for (const p of partsFmt(timeZone).formatToParts(new Date(t))) if (p.type !== "literal") out[p.type] = Number(p.value);
  return { y: out.year, m: out.month, d: out.day, h: out.hour === 24 ? 0 : out.hour, mi: out.minute, s: out.second };
}
/** Milliseconds the zone is ahead of UTC at instant t. */
function offsetAt(t: number, timeZone: string) {
  const p = wallParts(t, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
}
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "2026-11-20" + "09:30" read as a wall clock in timeZone, returned as a UTC ISO instant. The offset is checked
 * a second time at the candidate instant so a date across a DST change gets that day's offset, not today's.
 * A time that does not exist (the hour skipped in spring) lands just after the gap.
 */
export function zonedToIso(date: string, time: string, timeZone: string): string {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) throw new Error("Pick a date and a time.");
  const guess = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
  const off1 = offsetAt(guess, timeZone);
  const first = guess - off1;
  const off2 = offsetAt(first, timeZone);
  if (off2 === off1) return new Date(first).toISOString();
  const second = guess - off2;
  if (offsetAt(second, timeZone) === off2) return new Date(second).toISOString();
  return new Date(Math.max(first, second)).toISOString();
}

/** The YYYY-MM-DD and HH:MM an instant shows on a clock in timeZone. */
export function isoToZoned(iso: string, timeZone: string): { date: string; time: string } {
  const p = wallParts(new Date(iso).getTime(), timeZone);
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

export const todayIn = (timeZone: string, now = Date.now()) => isoToZoned(new Date(now).toISOString(), timeZone).date;

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "20 Nov 2026, 9:30 am" on the blog's clock. */
export const fmtZoned = (iso: string | null | undefined, timeZone: string, withTime = true) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", withTime ? { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone } : { day: "numeric", month: "short", year: "numeric", timeZone })
    : "";

/** "20 November" for a YYYY-MM-DD (a calendar date, so no zone shift). */
export const fmtYmd = (ymd: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
};
