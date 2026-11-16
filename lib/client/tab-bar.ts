/**
 * Phase 4 hid the phone tab bar on /create so it never stacked under the post actions bar. 11-16: the creator
 * wanted the tabs on /create too, so no page hides it now; a page with its own bottom bar sits that bar above the
 * tabs instead (ActionBar, BulkPlanner: env(safe-area-inset-bottom) + 74px, see .mtab in globals.css). The hook
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
