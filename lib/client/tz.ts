/** Timezone helpers: everything the creator sees is in THEIR timezone, not the browser's. */
export function partsInTz(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, weekday: p.weekday as string };
}

/** Wall-clock time in `tz` → real instant. */
function offsetAt(t: number, tz: string) {
  const p = partsInTz(new Date(t), tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(t / 60_000) * 60_000;
}

/** Wall-clock time in `tz` → real instant. A time skipped by a DST jump moves forward by
 *  the gap (02:30 on spring-forward night becomes 03:30); a time that happens twice when the
 *  clocks go back resolves to the first one. */
export function fromTzParts(y: number, m: number, d: number, h: number, min: number, tz: string) {
  const wall = Date.UTC(y, m - 1, d, h, min);
  const before = offsetAt(wall - 86_400_000, tz);
  const after = offsetAt(wall + 86_400_000, tz);
  const hits = [wall - before, wall - after].filter((t) => wall - offsetAt(t, tz) === t);
  if (hits.length) return new Date(Math.min(...hits));
  return new Date(wall - before);
}

export function dayKey(d: Date, tz: string) {
  const p = partsInTz(d, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function addDaysKey(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
