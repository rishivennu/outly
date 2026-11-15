/**
 * Perf: server timings the page carries for the client collector (workstream C), as
 * <meta name="x-timing" content="user=12;cfg=3">. Whole milliseconds only, never anything about the person.
 */
export type TimingParts = Record<string, number>;

export function timingContent(t: TimingParts) {
  return Object.entries(t)
    .filter(([k, v]) => /^[a-z]{1,12}$/.test(k) && Number.isFinite(v))
    .map(([k, v]) => `${k}=${Math.max(0, Math.round(v))}`)
    .join(";");
}

/** Every x-timing meta on the page merged into one record (a later meta wins on a repeated name). */
export function parseTiming(contents: string[]): TimingParts {
  const out: TimingParts = {};
  for (const c of contents)
    for (const part of c.split(";")) {
      const m = /^([a-z]{1,12})=(\d{1,6})$/.exec(part.trim());
      if (m) out[m[1]] = Number(m[2]);
    }
  return out;
}

/** How middleware got the maintenance and waitlist flags for this request. */
export type FlagSource = "hit" | "stale" | "miss" | "timeout" | "skip";

/** The Server-Timing header middleware puts on every page answer, readable in devtools and by curl. */
export function middlewareTiming(ms: number, flags: FlagSource) {
  return `mw;dur=${Math.max(0, Math.round(ms))};desc="middleware", flags;desc="${flags}"`;
}
