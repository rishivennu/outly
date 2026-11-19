/**
 * Phase 4 hid the phone tab bar on /create so it never stacked under the post actions bar. 11-16: the creator
 * wanted the tabs on /create too, so no page hides it now; a page with its own bottom bar sits that bar above the
 * tabs instead (ActionBar, BulkPlanner: env(safe-area-inset-bottom) + 84px, see .mtab in globals.css). The hook
 * stays so a page can opt out again by listing itself in NO_TAB_BAR.
 */
/** The phone tab bar's pages, in its order (Nav.tsx TABS). Where the bar is hidden, the menu drawer lists them. */
export const TAB_PAGES = ["/home", "/create", "/calendar", "/inbox", "/analytics"] as const;

const NO_TAB_BAR = new Set<string>([]);

export function hidesTabBar(path: string | null | undefined) {
  if (!path) return false;
  const p = path.split(/[?#]/)[0].replace(/\/+$/, "");
  return NO_TAB_BAR.has(p);
}

/**
 * 11-19, Instagram-style tabs: the phone tab bar no longer hides while you read, it compacts (Nav.tsx
 * useCompactOnScroll, .mtab[data-compact] in globals.css). One pure step per scroll frame, so the rule is testable:
 * reading on (the page scrolling down) by more than 48px in one run folds the labels away and shrinks the pill;
 * 12px back up, the top of the page, the last 80px, a short page or reduced motion open it again. A run restarts
 * whenever the direction flips, so touch jitter and a finger resting on the glass never flip the state, and the same
 * state coming back changes nothing (no animation while the direction holds). While you type, the page moving under
 * the keyboard counts for nothing. Only the window scrolls here: a list scrolling inside the page does not reach it.
 */
export type TabScroll = { y: number; run: number; compact: boolean };
export const TAB_SCROLL_START: TabScroll = { y: 0, run: 0, compact: false };
export function tabScrollStep(s: TabScroll, y: number, end: number, viewport: number, hold: { still?: boolean; typing?: boolean } = {}): TabScroll {
  const d = y - s.y;
  if (hold.still || end < viewport * 0.75 || y < 80 || end - y < 80) return { y, run: 0, compact: false };
  if (hold.typing) return { y, run: 0, compact: s.compact };
  const run = Math.sign(d) === Math.sign(s.run) ? s.run + d : d;
  return { y, run, compact: run > 48 ? true : run < -12 ? false : s.compact };
}

/*
 * R1213 (11-19), finger-following tabs: touch a tab and slide sideways, and the lime pill follows the finger across
 * the bar; letting go opens the tab under it. These are the rules, kept pure so they run in a test without a browser.
 * Nav.tsx useSlideTabs feeds them pointer events and writes the results into CSS variables on the bar (--i, --fx,
 * --sx), so following the finger never re-renders React.
 */

/** Where a finger at x sits along a track of n equal tabs: 0 at the first tab's centre, n - 1 at the last, clamped. */
export function slideIndex(x: number, left: number, width: number, n: number) {
  if (n <= 1 || width <= 0) return 0;
  return Math.min(n - 1, Math.max(0, (x - left) / (width / n) - 0.5));
}

/**
 * The gesture's direction, decided once the finger has moved past the slop: sideways ("h") slides the tabs, up or down
 * ("v") is the page scrolling and the bar leaves it alone, null while it is still just a touch.
 */
export function slideLock(dx: number, dy: number, slop = 10): "h" | "v" | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop) return null;
  return ax > ay ? "h" : "v";
}

/**
 * The tab a released finger lands on: the nearest, or one step on for a quick flick that never left its own tab (at
 * least `flick` px, still moving at `minV` px/ms when it let go; a slow drift that stays put stays put).
 */
export function slideTarget(fi: number, startIdx: number, dx: number, n: number, flick = 24, vx = Infinity, minV = 0.2) {
  let i = Math.round(fi);
  if (i === startIdx && Math.abs(dx) >= flick && Math.abs(vx) >= minV) i += Math.sign(dx);
  return Math.min(n - 1, Math.max(0, i));
}

/** How far the pill stretches in the direction of travel for a finger speed in px/ms: up to 35% longer, never shorter. */
export function slideStretch(vx: number, cap = 0.35) {
  return 1 + Math.min(cap, Math.abs(vx) * 0.25);
}
