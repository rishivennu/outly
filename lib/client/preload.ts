/**
 * 1114: every dashboard tab ready before it is opened. Pure helpers (unit tested); the component that runs them is
 * components/shell/WarmUp.tsx, the page-side freshness check is components/shell/PageFresh.tsx.
 *
 * How it fits together:
 *  - WarmUp prefetches each primary tab's full server render (the page and its data) one at a time while the
 *    browser is idle, after the open page has painted, and warms the numbers Analytics fetches after it shows.
 *    Next's router keeps a full prefetch for 5 minutes and never fetches one it still holds, so asking again on
 *    every navigation costs nothing until an entry has expired or a refresh has wiped them.
 *  - A tab opened from that cache paints at once. PageFresh, inside the page, compares when the server rendered it
 *    with the page's own age limit and with this tab's last change (lib/client/api lastWriteAt), and refreshes it in
 *    place when it is out of date. Nothing is thrown away: the numbers animate from what is shown to the new value.
 */

/** The tabs preloaded in the background, most used first. Create is a composer with nothing to load; Approvals and the
 *  rest load on intent (hover, focus, touch) only. */
export const PRELOAD_TABS = ["/home", "/analytics", "/calendar", "/inbox", "/content"] as const;

/** Is `path` inside the section `href` (e.g. /analytics/youtube is in /analytics)? */
export const inSection = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** What to warm from `path`, in order: every primary tab but the open one. Nothing while composing a post, which
 *  needs the connection for its uploads. */
export function preloadOrder(path: string): string[] {
  if (inSection(path, "/create")) return [];
  return PRELOAD_TABS.filter((h) => !inSection(path, h));
}

type Conn = { saveData?: boolean; effectiveType?: string };
/** Background loading only on a connection that can spare it: never with Save-Data, never on 2G. */
export function canPreload(nav: { connection?: Conn } | undefined = typeof navigator === "undefined" ? undefined : (navigator as unknown as { connection?: Conn })) {
  if (!nav) return false;
  const c = nav.connection;
  if (!c) return true;
  return !c.saveData && c.effectiveType !== "2g" && c.effectiveType !== "slow-2g";
}

/** First warm-up this long after the page settles, then one tab per idle moment this far apart. */
export const FIRST_MS = 1500;
export const GAP_MS = 600;

// How far this device's clock is ahead of the server's. Pages carry the server's render time, so their age is worked
// out on the server's clock and a wrong device clock can't make every page look stale (or fresh). Each sample also
// holds the time the page took to arrive (and, the first, to hydrate), so ages read young, never old; the smallest
// sample is the closest, so it is the one kept. Fed by the studio layout and by every page that is fresh off the server.
let offset: number | null = null;
export function noteServerClock(serverNow: number, now = Date.now(), fresh = false) {
  if (!Number.isFinite(serverNow) || serverNow <= 0) return;
  const o = now - serverNow;
  // `fresh`: the time was rendered just now (the studio layout, on a load or a refresh), unlike a page that may come
  // from the preload. Such a sample a minute off the kept one is the device clock being corrected: start from it.
  if (offset === null || o < offset || (fresh && o - offset > 60_000)) offset = o;
}
export const serverAge = (renderedAt: number, now = Date.now()) => now - (offset ?? 0) - renderedAt;
/** A time on this device's clock, on the server's. */
export const onServerClock = (t: number) => t - (offset ?? 0);

/** A page is out of date when it is older than `maxAge`, or when this tab sent a change after it was rendered. */
export function isStale(renderedAt: number | undefined, maxAge: number, wroteAt: number, now = Date.now()) {
  if (!renderedAt || !Number.isFinite(renderedAt)) return false;
  if (serverAge(renderedAt, now) > maxAge) return true;
  return wroteAt > 0 && wroteAt - (offset ?? 0) > renderedAt;
}

// One refresh per page per 15 s at most, so nothing (a clock jump, a slow server) can ever start a refresh loop.
const refreshed = new Map<string, number>();
export const mayRefresh = (path: string, now = Date.now()) => now - (refreshed.get(path) ?? -Infinity) > 15_000;
export const markRefreshed = (path: string, now = Date.now()) => void refreshed.set(path, now);
/** When this page last brought itself up to date (device clock), if it has. */
export const refreshedAt = (path: string) => refreshed.get(path);

// A page's own freshness refresh (PageFresh) is marked quiet, so the background preload doesn't start over for it.
let quiet = 0;
export const markQuiet = (now = Date.now()) => void (quiet = now + 1_000);
/** Was the refresh that just ran a quiet one? Answers once. */
export function takeQuiet(now = Date.now()) {
  const q = now < quiet;
  quiet = 0;
  return q;
}

// Whose data the memory holds. A different account in the same tab (no reload in between) starts empty.
let owner: string | null = null;
/** Record who is signed in; true when that changed from someone else, so the caller drops what it kept. */
export function claimFor(who: string | null) {
  if (owner === who) return false;
  const changed = owner !== null;
  owner = who;
  return changed;
}

/** A different account in this tab: its pages' refresh times are not the last one's. */
export function forgetRefreshes() {
  refreshed.clear();
  quiet = 0;
}

/** Tests only. */
export function __resetPreload() {
  offset = null;
  owner = null;
  quiet = 0;
  refreshed.clear();
}

/**
 * A fresh first page merged into a list that may hold more (loaded with "Show more"): new posts first, every post the
 * server sent replaced by its fresh copy, the rest kept where they were.
 */
export function mergeFresh<T extends { id: string }>(fresh: readonly T[], prev: readonly T[]): T[] {
  const next = new Map(fresh.map((p) => [p.id, p] as const));
  const had = new Set(prev.map((p) => p.id));
  return [...fresh.filter((p) => !had.has(p.id)), ...prev.map((p) => next.get(p.id) ?? p)];
}
