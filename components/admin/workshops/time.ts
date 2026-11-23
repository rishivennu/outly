export const ZONES = ["Asia/Kolkata", "UTC", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"] as const;

const parts = (t: number, tz: string) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
  const g = (k: string) => Number(p.find((x) => x.type === k)?.value ?? 0);
  return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour") % 24, mi: g("minute"), s: g("second") };
};

const offsetAt = (t: number, tz: string) => {
  const w = parts(t, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
};

/** The UTC instant for a wall-clock date and time in `tz`. A wall time skipped by a DST jump lands on the later offset. */
export function zonedToIso(date: string, time: string, tz: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  if ([y, mo, d, h, mi].some((n) => !Number.isFinite(n))) throw new Error("Pick a date and a time.");
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall;
  for (let i = 0; i < 3; i++) {
    const next = wall - offsetAt(t, tz);
    if (next === t) break;
    t = next;
  }
  return new Date(t).toISOString();
}

const pad = (n: number) => String(n).padStart(2, "0");

export function isoToZoned(iso: string, tz: string): { date: string; time: string } {
  const w = parts(new Date(iso).getTime(), tz);
  return { date: `${w.y}-${pad(w.mo)}-${pad(w.d)}`, time: `${pad(w.h)}:${pad(w.mi)}` };
}
