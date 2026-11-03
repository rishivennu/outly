/**
 * 1114: which visit of a page this is. A visit starts whenever the path changes, so coming back to a tab is a new
 * visit (its numbers count up from zero again, as on first open), while a range switch, a refresh or a remount on
 * the same page stays in one visit (numbers move from what was shown). RouteStage notes every committed path, so a
 * visit to a page without numbers still ends the one before; AnimatedNumber notes its own (it may commit first).
 */
let cur: { path: string | null; n: number } = { path: null, n: 0 };
export function visitOf(path: string) {
  if (cur.path !== path) cur = { path, n: cur.n + 1 };
  return cur.n;
}
/** A different account in this tab: whatever page comes next is a new visit, so no number moves on from the last
 *  account's value. */
export function forgetVisits() {
  cur = { path: null, n: cur.n };
}
