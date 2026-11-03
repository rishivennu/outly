/** 1100: pulse rail (collapsible pill sidebar) + desktop account menu. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { accountItems, isActive, railScript, RAIL_KEY, workspaceItems } from "../components/shell/nav-items";

const src = (p: string) => readFileSync(p, "utf8");
const rail = src("components/shell/PulseRail.tsx");
const menu = src("components/shell/AccountMenu.tsx");
const nav = src("components/shell/Nav.tsx");
const css = src("app/globals.css");
const railCss = css.slice(css.indexOf(".rail {"));

describe("1100 pulse rail", () => {
  test("width is restored before first paint from the same key the toggle writes", () => {
    expect(src("app/layout.tsx")).toContain("dangerouslySetInnerHTML={{ __html: railScript }}");
    expect(railScript).toContain(`localStorage.getItem("${RAIL_KEY}")==="open"`);
    expect(railScript).toContain('setAttribute("data-rail","open")');
    expect(rail).toMatch(/localStorage\.setItem\(RAIL_KEY/);
  });
  test("toggle is a real button with state for assistive tech", () => {
    expect(rail).toContain("aria-expanded={open}");
    expect(rail).toContain('"Collapse sidebar" : "Expand sidebar"');
  });
  test("tooltips only while collapsed, labels shown when open", () => {
    expect(rail).toContain("open={open && !expanded}");
    expect(css).toMatch(/html\[data-rail="open"\] \.rail \{ width: 232px;/);
  });
  test("only the pulse style gets the rail, desktop only", () => {
    expect(nav).toContain("<PulseRail />");
    expect(rail).toContain('data-shell="pulse"');
    expect(rail).toMatch(/hidden h-dvh[^"]*lg:block/);
  });
  test("rail and menu motion only when the user allows it", () => {
    const block = railCss.slice(railCss.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(block.slice(0, 200)).toContain(".rail { transition: width");
    expect(css).toMatch(/\.acct-menu\[data-state="open"\] \{ animation: page-fade/);
  });
});

describe("1100 account menu", () => {
  test("billing hidden for teammates; settings deep links", () => {
    const owner = accountItems(false), mate = accountItems(true);
    expect(owner.more.some((i) => i.href === "/billing")).toBe(true);
    expect(mate.more.some((i) => i.href === "/billing")).toBe(false);
    expect(owner.account.map((i) => i.href)).toEqual(["/settings?tab=profile", "/settings?tab=security", "/settings?tab=personalization"]);
    expect(workspaceItems(true).some((i) => i.href === "/accounts" || i.href === "/billing")).toBe(false);
  });
  test("isActive ignores the query and never matches a sibling prefix", () => {
    expect(isActive("/settings", "/settings?tab=profile")).toBe(true);
    expect(isActive("/create/bulk", "/create")).toBe(true);
    expect(isActive("/creator", "/create")).toBe(false);
    expect(isActive(null, "/home")).toBe(false);
  });
  test("keyboard: roving focus, Escape via Radix, logout confirms", () => {
    expect(menu).toContain("ArrowDown");
    expect(menu).toContain("[data-mi]");
    expect(menu).toContain("useSignOut");
    expect(src("components/shell/SignOutButton.tsx")).toMatch(/export const SignOutButton = forwardRef/);
  });
});

describe("1100 phone drawer", () => {
  const drawer = src("components/shell/MobileDrawer.tsx");
  const bar = nav.slice(nav.indexOf("export function MobileTopBar"));
  test("tab bar: Home, Create, Calendar, Inbox, Analytics; no More panel left", () => {
    expect(nav).toContain('const TABS = ["/home", "/create", "/calendar", "/inbox", "/analytics"];');
    expect(nav).not.toContain("more-panel");
    expect(css).not.toContain(".mtab-more");
  });
  test("top bar: menu button replaces the theme button, still three 44px controls", () => {
    expect(bar).toContain('<MobileDrawer className="mtop-btn" />');
    expect(bar).not.toContain("ThemeCycleButton");
    expect(drawer).toContain('aria-label="Open menu"');
    expect(drawer).toContain('aria-label="Close menu"');
  });
  test("drawer: Radix dialog with title, closes on pick and route change, logout after it has gone", () => {
    expect(drawer).toContain("<Dialog.Title");
    expect(drawer).toContain("useEffect(() => setOpen(false), [path]);");
    expect(drawer).toContain("onPick={() => setOpen(false)}");
    expect(drawer).toMatch(/onCloseAutoFocus[\s\S]*ask\(trigger\.current\)/);
    expect(drawer).toContain("overscroll-contain");
  });
  test("drawer lists every page the tabs do not, teammates without accounts", async () => {
    const { drawerItems } = await import("../components/shell/MobileDrawer");
    const tabs = ["/home", "/create", "/calendar", "/inbox", "/analytics"];
    const all = [...tabs, ...drawerItems(false).map((i) => i.href), ...accountItems(false).more.map((i) => i.href)];
    for (const h of ["/content", "/approvals", "/accounts", "/billing", "/support", "/settings"]) expect(all).toContain(h);
    expect(drawerItems(true).some((i) => i.href === "/accounts")).toBe(false);
  });
  test("safe areas and reduced motion", () => {
    for (const side of ["top", "right", "bottom"]) expect(css).toMatch(new RegExp(`\\.mdrawer \\{[^}]*padding-${side}: env\\(safe-area-inset-${side}\\)`));
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.mdrawer\[data-state="open"\], \.mdrawer-scrim\[data-state="open"\] \{ animation: page-fade/);
  });
});

describe("1100 review fixes", () => {
  const acct = src("components/shell/AccountMenu.tsx");
  test("rail: 72px collapsed, state read before paint, timer cleared, script icon-free", () => {
    expect(css).toMatch(/\.rail \{[^}]*width: 72px/);
    expect(rail).toContain("useLayoutEffect(() => setOpen(");
    expect(rail).toContain("clearTimeout(settle.current)");
    expect(src("lib/rail.ts")).not.toContain("lucide");
    expect(src("app/layout.tsx")).toContain('import { railScript } from "@/lib/rail";');
  });
  test("menu: theme radios keep their arrows; height capped; logout after close", () => {
    expect(acct).toContain(`closest('[role="radiogroup"]')`);
    expect(acct).toContain("max-h-[var(--radix-popover-content-available-height)]");
    expect(acct).toMatch(/onCloseAutoFocus[\s\S]*ask\(trigger\.current\)/);
    expect(acct).toContain('target: "_blank", rel: "noopener"');
  });
});
