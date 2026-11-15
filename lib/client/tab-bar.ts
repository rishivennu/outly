/**
 * Phase 4: pages that bring their own bottom bar hide the shell's phone tab bar, so the two never stack.
 * /create has the sticky post actions bar; /create/bulk keeps the tab bar (its own bar sits above it).
 */
/** The phone tab bar's pages, in its order (Nav.tsx TABS). Where the bar is hidden, the menu drawer lists them. */
export const TAB_PAGES = ["/home", "/create", "/calendar", "/inbox", "/analytics"] as const;

export function hidesTabBar(path: string | null | undefined) {
  if (!path) return false;
  const p = path.split(/[?#]/)[0].replace(/\/+$/, "");
  return p === "/create";
}
