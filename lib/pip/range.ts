/**
 * Date ranges for Pip (1049), worked out in the creator's own timezone so "last month" means their calendar
 * month, not UTC's. Deterministic on purpose: the dates a financial answer covers never come from a model.
 * `to` is exclusive. Every range carries a label that Pip prints, so the person can see exactly what was searched.
 */
export type DateRange = { from: Date; to: Date; label: string; tz: string };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, few: 3 };
const monthIndex = (s: string) => MONTHS.findIndex((m) => m.startsWith(s.slice(0, 3)));

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMin(at: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, Number(x.value)]),
  );
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Midnight at the start of y-m-d on the wall clock in `tz` (month may overflow, Date.UTC normalises it). */
export function zonedMidnight(y: number, m: number, d: number, tz: string) {
  const guess = Date.UTC(y, m, d);
  const first = guess - offsetMin(new Date(guess), tz) * 60000;
  return new Date(guess - offsetMin(new Date(first), tz) * 60000);
}

/** The wall-clock date in `tz` right now. */
export function zonedToday(now: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
      .formatToParts(now)
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month) - 1, d: Number(p.day), wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}

export function safeTz(tz: string | null | undefined) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC" });
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

/** "29 Jul 2026" in the creator's zone. */
export function dayLabel(at: Date, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(at);
}

function make(from: Date, to: Date, name: string, tz: string, now: Date): DateRange {
  const end = to.getTime() > now.getTime() ? now : to;
  const last = new Date(Math.max(from.getTime(), end.getTime() - 1));
  return { from, to: end, label: `${name} (${dayLabel(from, tz)} to ${dayLabel(last, tz)})`, tz };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const monthName = (m: number) => cap(MONTHS[((m % 12) + 12) % 12]);

/**
 * The period a message asks about, or null when it names none. Understands "last 3 months", "past 90 days",
 * "last month", "this month", "this year", "last year", "last quarter", "this week", "today", "yesterday",
 * "July to September", "between January and March 2026", "in August", "since May", "2025".
 */
export function parseRange(text: string, tzIn: string, now = new Date()): DateRange | null {
  const tz = safeTz(tzIn);
  const t = ` ${text.toLowerCase().replace(/[,.!?]/g, " ").replace(/\s+/g, " ")} `;
  const { y, m, d, wd } = zonedToday(now, tz);
  const mid = (yy: number, mm: number, dd: number) => zonedMidnight(yy, mm, dd, tz);
  const tomorrow = mid(y, m, d + 1);

  // Month to month, optionally with years: "from july to september", "between jan and mar 2026"
  const span = t.match(new RegExp(`\\b${MON_RE}(?:\\s+(\\d{4}))?\\s*(?:to|-|–|through|thru|until|till|and)\\s*${MON_RE}\\b(?:\\s+(\\d{4}))?`));
  if (span) {
    const a = monthIndex(span[1]);
    const b = monthIndex(span[3]);
    let yb = span[4] ? Number(span[4]) : span[2] ? Number(span[2]) : y;
    // No year given and the end month hasn't started yet this year: they mean the last time it happened.
    if (!span[4] && !span[2] && b > m) yb -= 1;
    const ya = span[2] ? Number(span[2]) : a > b ? yb - 1 : yb;
    return make(mid(ya, a, 1), mid(yb, b + 1, 1), `${monthName(a)} ${ya} to ${monthName(b)} ${yb}`, tz, now);
  }

  // "this month compared with last month": the period asked about is this one; the comparison comes after.
  if (/\b(compare|compared|vs|versus|against)\b/.test(t)) {
    const cur = t.match(/\bthis (week|month|quarter|year)\b/);
    if (cur) return parseRange(`this ${cur[1]}`, tz, now);
  }

  const rel = t.match(/\b(?:last|past|previous|prior|recent)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few)?\s*(?:of\s+)?(day|week|month|quarter|year)s?\b/);
  if (rel) {
    const n = rel[1] ? (NUM[rel[1]] ?? Number(rel[1])) : 1;
    const unit = rel[2];
    const plural = !!rel[1] && !(rel[1] in { a: 1, an: 1 });
    if (!plural && n === 1) {
      // "last month" / "last year" / "last week" / "last quarter": the previous calendar period.
      if (unit === "month") return make(mid(y, m - 1, 1), mid(y, m, 1), `${monthName(m - 1)} ${m === 0 ? y - 1 : y}`, tz, now);
      if (unit === "year") return make(mid(y - 1, 0, 1), mid(y, 0, 1), `${y - 1}`, tz, now);
      if (unit === "quarter") {
        const q = Math.floor(m / 3);
        return make(mid(y, (q - 1) * 3, 1), mid(y, q * 3, 1), "Last quarter", tz, now);
      }
      if (unit === "week") {
        const monday = d - ((wd + 6) % 7);
        return make(mid(y, m, monday - 7), mid(y, m, monday), "Last week", tz, now);
      }
      return make(mid(y, m, d - 1), mid(y, m, d), "Yesterday", tz, now);
    }
    // "last 3 months": rolling, from the same date 3 months back (29 Jul to 29 Oct), today included.
    const from =
      unit === "day" ? mid(y, m, d - n + 1)
      : unit === "week" ? mid(y, m, d - 7 * n + 1)
      : unit === "month" ? mid(y, m - n, d)
      : unit === "quarter" ? mid(y, m - 3 * n, d)
      : mid(y - n, m, d);
    return make(from, tomorrow, `Last ${n} ${unit}${n === 1 ? "" : "s"}`, tz, now);
  }

  if (/\btoday\b/.test(t)) return make(mid(y, m, d), tomorrow, "Today", tz, now);
  if (/\byesterday\b/.test(t)) return make(mid(y, m, d - 1), mid(y, m, d), "Yesterday", tz, now);
  if (/\bthis week\b/.test(t)) return make(mid(y, m, d - ((wd + 6) % 7)), tomorrow, "This week", tz, now);
  if (/\bthis month\b/.test(t)) return make(mid(y, m, 1), tomorrow, `${monthName(m)} ${y} so far`, tz, now);
  if (/\bthis quarter\b/.test(t)) return make(mid(y, Math.floor(m / 3) * 3, 1), tomorrow, "This quarter so far", tz, now);
  if (/\b(this year|year to date|ytd)\b/.test(t)) return make(mid(y, 0, 1), tomorrow, `${y} so far`, tz, now);

  const since = t.match(new RegExp(`\\bsince\\s+${MON_RE}(?:\\s+(\\d{4}))?`));
  if (since) {
    const a = monthIndex(since[1]);
    const ya = since[2] ? Number(since[2]) : a > m ? y - 1 : y;
    return make(mid(ya, a, 1), tomorrow, `Since ${monthName(a)} ${ya}`, tz, now);
  }
  const one = t.match(new RegExp(`\\b(?:in|for|during|of|from)?\\s*${MON_RE}(?:\\s+(\\d{4}))?\\b`));
  // "may" is also a verb: only take it with a year or a preposition in front.
  if (one && !(one[1] === "may" && !one[2] && !/\b(in|for|during|of|from) may\b/.test(t))) {
    const a = monthIndex(one[1]);
    const ya = one[2] ? Number(one[2]) : a > m ? y - 1 : y;
    return make(mid(ya, a, 1), mid(ya, a + 1, 1), `${monthName(a)} ${ya}`, tz, now);
  }
  // A bare year, but never the year inside a document number like OUT-2026-000123.
  const yr = t.match(/(?<![\w-])(20\d{2})(?![\w-])/);
  if (yr) {
    const yy = Number(yr[1]);
    return make(mid(yy, 0, 1), mid(yy + 1, 0, 1), `${yy}`, tz, now);
  }
  return null;
}

/** The same length of time just before `r` (calendar month before a calendar month), for "compared with". */
export function previousRange(r: DateRange, now = new Date()): DateRange {
  const len = r.to.getTime() - r.from.getTime();
  const { y, m, d } = zonedToday(r.from, r.tz);
  const isMonthStart = d === 1 && zonedMidnight(y, m, 1, r.tz).getTime() === r.from.getTime();
  if (isMonthStart) {
    const from = zonedMidnight(y, m - 1, 1, r.tz);
    // Month so far vs the same days of last month; a whole month vs the whole month before.
    const fullPrev = zonedMidnight(y, m, 1, r.tz);
    const to = new Date(Math.min(fullPrev.getTime(), from.getTime() + len));
    return { from, to, label: `${monthName(m - 1)} ${m === 0 ? y - 1 : y} (${dayLabel(from, r.tz)} to ${dayLabel(new Date(to.getTime() - 1), r.tz)})`, tz: r.tz };
  }
  const from = new Date(r.from.getTime() - len);
  void now;
  return { from, to: r.from, label: `The ${Math.round(len / 864e5)} days before (${dayLabel(from, r.tz)} to ${dayLabel(new Date(r.from.getTime() - 1), r.tz)})`, tz: r.tz };
}
