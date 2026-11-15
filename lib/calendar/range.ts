/**
 * P2 calendar: which days a view shows and the instants that bound them, in the creator's timezone.
 * Pure and client-safe (the page, the API route and the browser all agree on the same window).
 */
import { addDaysKey, dayKey, fromTzParts, partsInTz } from "@/lib/client/tz";

export const VIEWS = ["day", "week", "month", "upcoming"] as const;
export type CalView = (typeof VIEWS)[number];
export const VIEW_LABEL: Record<CalView, string> = { day: "Day", week: "Week", month: "Month", upcoming: "Upcoming" };
export const isView = (v: unknown): v is CalView => typeof v === "string" && (VIEWS as readonly string[]).includes(v);

/** A month grid is at most 6 weeks; nothing asks the server for more than this many days at once. */
export const MAX_RANGE_DAYS = 42;
export const UPCOMING_PAGE = 20;
export const DRAFTS_PAGE = 8;

export function isDayKey(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v;
}

const keyDate = (key: string) => new Date(`${key}T12:00:00Z`);
/** Monday = 0. */
export const weekdayOf = (key: string) => (keyDate(key).getUTCDay() + 6) % 7;
export const weekStart = (key: string) => addDaysKey(key, -weekdayOf(key));
export const monthStart = (key: string) => `${key.slice(0, 7)}-01`;
export const daysBetween = (a: string, b: string) => Math.round((+keyDate(b) - +keyDate(a)) / 864e5);

function addMonths(key: string, n: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/** The day keys a view lays out (a month grid runs Monday to Sunday, 4 to 6 weeks). Upcoming has none. */
export function visibleDays(view: CalView, anchor: string): string[] {
  if (view === "upcoming") return [];
  if (view === "day") return [anchor];
  if (view === "week") {
    const s = weekStart(anchor);
    return Array.from({ length: 7 }, (_, i) => addDaysKey(s, i));
  }
  const first = monthStart(anchor);
  const last = addDaysKey(addMonths(first, 1), -1);
  const s = weekStart(first);
  const weeks = Math.ceil((daysBetween(s, last) + 1) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDaysKey(s, i));
}

/** Next or previous page of a view. A month keeps to the 1st so a short month never skips one. */
export function shiftAnchor(view: CalView, anchor: string, n: number) {
  if (view === "day") return addDaysKey(anchor, n);
  if (view === "week") return addDaysKey(weekStart(anchor), n * 7);
  if (view === "month") return addMonths(monthStart(anchor), n);
  return anchor;
}

/** True when `day` is on the page a view shows for `anchor`. */
export function onPage(view: CalView, anchor: string, day: string) {
  if (view === "day") return anchor === day;
  if (view === "week") return weekStart(anchor) === weekStart(day);
  if (view === "month") return anchor.slice(0, 7) === day.slice(0, 7);
  return true;
}

const at = (k: string, tz: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return fromTzParts(y, m, d, 0, 0, tz);
};

/** [from, to): midnight of the first day to midnight after the last, in `tz`. */
export function rangeOf(days: string[], tz: string) {
  return { from: at(days[0], tz), to: at(addDaysKey(days[days.length - 1], 1), tz) };
}

/** Where a post sits on the calendar: its booked time, else when it went out. Undated drafts sit nowhere. */
export const placedAt = (p: { scheduledAt: string | null; publishedAt: string | null }) => p.scheduledAt ?? p.publishedAt;
export const isUnscheduledDraft = (p: { status: string; scheduledAt: string | null }) => p.status === "draft" && !p.scheduledAt;

export function groupByDay<P extends { scheduledAt: string | null; publishedAt: string | null }>(posts: P[], tz: string) {
  const m = new Map<string, P[]>();
  for (const p of posts) {
    const t = placedAt(p);
    if (!t) continue;
    const k = dayKey(new Date(t), tz);
    const list = m.get(k);
    if (list) list.push(p);
    else m.set(k, [p]);
  }
  for (const list of m.values()) list.sort((a, b) => +new Date(placedAt(a)!) - +new Date(placedAt(b)!));
  return m;
}

/** Windows already loaded, as [from, to) ms pairs. True when [from, to) sits inside one of them. */
export const covered = (wins: readonly (readonly [number, number])[], from: number, to: number) => wins.some(([a, b]) => a <= from && to <= b);

/** A post's slot moved to another day, keeping its time of day in `tz`. */
export function sameTimeOn(iso: string, key: string, tz: string) {
  const was = partsInTz(new Date(iso), tz);
  const [y, m, d] = key.split("-").map(Number);
  return fromTzParts(y, m, d, was.h, was.min, tz);
}

/** Checked server side too: a range the API is asked for. */
export function validRange(from: Date, to: Date) {
  const ms = +to - +from;
  return Number.isFinite(ms) && ms > 0 && ms <= (MAX_RANGE_DAYS + 1) * 864e5;
}

/** A fresh answer for [from, to) replaces whatever the list held placed in that window; the rest stays. */
export function mergeWindow<P extends { id: string; scheduledAt: string | null; publishedAt: string | null }>(list: P[], fresh: P[], from: number, to: number) {
  const ids = new Set(fresh.map((p) => p.id));
  const kept = list.filter((p) => {
    if (ids.has(p.id)) return false;
    const t = placedAt(p);
    return !t || +new Date(t) < from || +new Date(t) >= to;
  });
  return [...kept, ...fresh];
}

/** Adds or replaces by id, keeping order for the ones already there. */
export function upsertAll<P extends { id: string }>(list: P[], fresh: P[]) {
  const byId = new Map(fresh.map((p) => [p.id, p]));
  const out = list.map((p) => byId.get(p.id) ?? p);
  for (const p of fresh) if (!list.some((x) => x.id === p.id)) out.push(p);
  return out;
}

/**
 * The upcoming list, from what is loaded: booked from `now` on, soonest first. While more pages wait on the server,
 * it stops at the last one it was handed (`horizon`), so a gap is never shown as "nothing booked".
 */
export function upcomingOf<P extends { status: string; scheduledAt: string | null; id: string }>(list: P[], now: number, horizon: string | null) {
  const end = horizon ? +new Date(horizon) : Infinity;
  return list
    .filter((p) => p.scheduledAt && p.status !== "published" && +new Date(p.scheduledAt) >= now && +new Date(p.scheduledAt) <= end)
    .sort((a, b) => +new Date(a.scheduledAt!) - +new Date(b.scheduledAt!) || (a.id < b.id ? -1 : 1));
}
