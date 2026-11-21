/** R1290 STUDIO: the Dock as a second desktop navigation, its preference plumbing, Settings and the admin default. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DOCK_MAIN_PAD, NAV_COOKIE, NAV_DEFAULT, NAV_STYLES, isNavStyle, normalizeNav, resolveNav } from "../lib/nav-config";
import { DEFAULTS } from "../lib/settings";
import { MAIN } from "../components/shell/nav-items";

const read = (p: string) => readFileSync(p, "utf8");
const dock = read("components/shell/StudioDock.tsx");
const nav = read("components/shell/Nav.tsx");
const layout = read("app/(studio)/layout.tsx");
const meRoute = read("app/api/me/nav/route.ts");
const adminRoute = read("app/api/admin/nav/route.ts");
const style = read("lib/nav-style.ts");
const pref = read("components/settings/NavStylePref.tsx");
const picker = read("components/admin/NavStylePicker.tsx");

describe("R1290 config", () => {
  test("two styles, sidebar by default, people may switch, cookie ol_nav", () => {
    expect([...NAV_STYLES]).toEqual(["sidebar", "dock"]);
    expect(NAV_DEFAULT).toEqual({ style: "sidebar", userSwitch: true });
    expect(NAV_COOKIE).toBe("ol_nav");
    expect(DEFAULTS.nav).toEqual(NAV_DEFAULT);
  });
  test("isNavStyle accepts only the two names", () => {
    expect(isNavStyle("sidebar")).toBe(true);
    expect(isNavStyle("dock")).toBe(true);
    for (const v of ["Dock", "rail", "", null, undefined, 1, {}]) expect(isNavStyle(v)).toBe(false);
  });
  test("normalizeNav fills gaps from the default and drops junk", () => {
    expect(normalizeNav(null)).toEqual(NAV_DEFAULT);
    expect(normalizeNav({})).toEqual(NAV_DEFAULT);
    expect(normalizeNav({ style: "dock" })).toEqual({ style: "dock", userSwitch: true });
    expect(normalizeNav({ style: "nope" as never, userSwitch: false })).toEqual({ style: "sidebar", userSwitch: false });
    expect(normalizeNav({ userSwitch: "yes" as never })).toEqual(NAV_DEFAULT);
  });
  test("resolveNav: the browser's pick wins only while switching is allowed", () => {
    expect(resolveNav({ style: "sidebar", userSwitch: true }, "dock")).toBe("dock");
    expect(resolveNav({ style: "dock", userSwitch: true }, "sidebar")).toBe("sidebar");
    expect(resolveNav({ style: "sidebar", userSwitch: false }, "dock")).toBe("sidebar");
    expect(resolveNav({ style: "dock", userSwitch: false }, "sidebar")).toBe("dock");
    expect(resolveNav({ style: "dock", userSwitch: true }, "junk")).toBe("dock");
    expect(resolveNav({ style: "sidebar", userSwitch: true }, undefined)).toBe("sidebar");
  });
  test("navFor is server-only, reads config + cookie, never throws (sidebar on error)", () => {
    expect(style).toContain('import "server-only";');
    expect(style).toContain('getConfig("nav")');
    expect(style).toContain("NAV_COOKIE");
    expect(style).toMatch(/catch \{\s*return \{ style: "sidebar", canSwitch: false, own: false, intro: false \};/);
  });
});

describe("R1290 API routes", () => {
  test("POST /api/me/nav: 403 when locked, httpOnly cookie for a year", () => {
    expect(meRoute).toContain("export const POST");
    expect(meRoute).toContain("new HttpError(403");
    expect(meRoute).toContain("if (!cfg.userSwitch)");
    expect(meRoute).toMatch(/cookies\(\)\)\.set\(NAV_COOKIE, style, cookieOpts\)/);
    expect(meRoute).toMatch(/const cookieOpts = \{ httpOnly: true[^}]*maxAge: 365 \* 86400/);
    expect(meRoute).toContain("z.enum(NAV_STYLES)");
  });
  test("DELETE /api/me/nav clears the pick", () => {
    expect(meRoute).toContain("export const DELETE");
    expect(meRoute).toContain("(await cookies()).delete(NAV_COOKIE)");
  });
  test("admin route: GET + PUT behind the site area, strict body, saved under nav", () => {
    expect(adminRoute).toContain('export const GET = adminRoute("site"');
    expect(adminRoute).toContain('export const PUT = adminRoute("site"');
    expect(adminRoute).toContain(".strict()");
    expect(adminRoute).toContain('saveConfig("nav", b)');
  });
});

describe("R1290 layout: the server picks rail or dock", () => {
  test("Sidebar takes the style and renders exactly one of the two", () => {
    expect(nav).toMatch(/export function Sidebar\(\{ style \}: \{ style: NavStyle \}\)/);
    expect(nav).toContain('if (style === "dock") return <StudioDock />;');
    expect(nav).toContain("return <PulseRail />;");
  });
  test("layout reads navFor alongside the other reads and passes the style", () => {
    expect(layout).toContain('import { navFor } from "@/lib/nav-style";');
    expect(layout).toMatch(/sid, nav\] = await Promise\.all\(\[/);
    expect(layout).toContain("navFor(),");
    // R1291: the frame is client state (NavStyleProvider + NavFrame), seeded by the server, so a switch needs no reload.
    expect(layout).toContain("<NavStyleProvider initial={nav}>");
    expect(layout).toContain("<NavFrame>");
    expect(read("components/shell/NavStyleProvider.tsx")).toContain("<Sidebar style={style} />");
    expect(read("components/shell/NavStyleProvider.tsx")).toContain('data-nav={style}');
  });
  test("dock pad replaces lg:pb-0 only in dock mode; phone padding untouched", () => {
    expect(DOCK_MAIN_PAD).toBe("lg:pb-0 lg:[[data-nav=dock]_&]:pb-[calc(var(--sa-b)+96px)]");
    expect(layout).toContain("${DOCK_MAIN_PAD}`}");
    expect(layout).toContain("pb-[calc(var(--sa-b)+88px)] max-lg:[body:has([data-tabbar-off])_&]:pb-[var(--sa-b)]");
    expect(layout).toContain('from "@/lib/nav-config"');
  });
  test("no client swap, no <html> edits for the nav", () => {
    expect(layout).not.toMatch(/<html/);
    expect(dock).not.toContain("document.documentElement");
    expect(dock).not.toContain("useEffect");
  });
  test("toasts rise above the dock", () => {
    expect(read("components/shared/Toast.tsx")).toContain("lg:[body:has([data-nav=dock])_&]:bottom-");
  });
});

describe("R1290 StudioDock", () => {
  test("built on the motion Dock primitive", () => {
    expect(dock.startsWith('"use client";')).toBe(true);
    expect(dock).toContain('import { Dock, DockItem, DockSeparator } from "@/components/ui/motion/Dock";');
    expect(dock).toContain('<Dock label="Primary"');
    expect(dock.match(/<DockSeparator \/>/g)?.length).toBe(2);
  });
  test("desktop only, wrapper lets clicks through, the dock takes them", () => {
    expect(dock).toMatch(/className="studio-dock pointer-events-none fixed inset-x-0 bottom-\[max\(16px,var\(--sa-b\)\)\] z-40 hidden justify-center[^"]*lg:flex"/);
    expect(dock).toContain('className="pointer-events-auto');
  });
  test("every MAIN item, the workspace group, Search, Notices and Account", () => {
    expect(MAIN.length).toBe(9);
    expect(dock).toContain("MAIN.map(");
    expect(dock).toContain("workspaceItems(who.teammate)");
    expect(dock).toContain("isActive(path, href)");
    expect(dock).toContain('label="Search" onClick={() => openPalette()}');
    expect(dock).toContain('"aria-keyshortcuts": "Control+K Meta+K"');
    expect(dock).toContain('<NoticesBell placement="above"');
    expect(dock).toContain('<AccountMenu side="top">');
    expect(dock).toContain('label="Outlly dashboard" href="/home"');
  });
  test("Create is lime, tour targets kept, the studio press effect still mounts", () => {
    expect(dock).toContain("bg-lime text-lime-foreground");
    expect(dock).toContain('"data-tour": TOUR[href]');
    expect(dock).toContain("usePressFx();");
  });
  test("bell panel opens above the dock; account menu opens upward", () => {
    const bell = read("components/shell/NoticesBell.tsx");
    expect(bell).toContain('placement?: "side" | "below" | "above"');
    expect(bell).toContain('placement === "above"');
    expect(read("components/shell/AccountMenu.tsx")).toContain('side?: "right" | "bottom" | "top"');
  });
  test("no spring literals outside the token files", () => {
    for (const s of [dock, pref, picker]) {
      expect(s).not.toContain("stiffness:");
      expect(s).not.toMatch(/bounce:\s*0\./);
    }
  });
});

describe("R1290 Settings and Admin pickers", () => {
  test("Preferences card: two tiles, the copy, the lock note and the reset", () => {
    expect(pref).toContain('{ id: "sidebar", name: "Sidebar", tag: "Original", body: "The rail on the left, collapsible, as today." }');
    expect(pref).toContain('{ id: "dock", name: "Dock", tag: "New", body: "A floating dock along the bottom, macOS style. Icons grow as you hover." }');
    expect(pref).toContain("Your workspace admin has set the navigation for everyone.");
    expect(pref).toContain("Use the workspace default");
    // R1291: the control writes through the shared NavStyleProvider (one source for Settings, the switcher, the frame).
    expect(pref).toContain("useNavStyle()");
    expect(pref).not.toContain("router.refresh()");
    expect(pref).toContain("Dock is on. Your sidebar is one click away here.");
    expect(pref).toContain("Sidebar is back.");
    expect(pref).toContain('type="radio"');
  });
  test("Settings card sits first in Personalization; the pick comes from the shared provider (R1291)", () => {
    const view = read("components/settings/SettingsView.tsx");
    expect(view).toContain("<NavStylePref />");
    expect(view).toMatch(/<NavStylePref \/>\n\s*<SnippetsCard \/>/);
    const page = read("app/(studio)/settings/page.tsx");
    expect(page).not.toContain("navFor()");
    expect(page).not.toContain("navStyle={");
  });
  test("Admin picker: default tiles + switch, PUT /api/admin/nav, mounted under the dashboard picker", () => {
    expect(picker).toContain('"/api/admin/nav", { method: "PUT"');
    expect(picker).toContain("NAV_TILES.map(");
    expect(picker).toContain("<Switch on={cfg.userSwitch}");
    expect(picker).toContain("Everyone now gets the ${name(c.style)}${c.userSwitch ? \" unless they picked their own\" : \"\"}.");
    const page = read("app/admin/(panel)/dashboard/page.tsx");
    expect(page).toContain('getConfig("nav").then(normalizeNav)');
    expect(page).toMatch(/<DashboardStylePicker initial=\{cfg\} \/>[\s\S]*>Navigation<\/h2>[\s\S]*<NavStylePicker initial=\{nav\} \/>/);
  });
  test("no em-dashes and no 'it's not X, it's Y' copy in the new UI", () => {
    for (const s of [dock, pref, picker]) {
      expect(s).not.toContain("\u2014");
      expect(s).not.toMatch(/it'?s not [^.]*, it'?s/i);
    }
  });
  test("targets at least 44px and visible focus", () => {
    expect(pref).toContain("min-h-11");
    expect(pref).toContain("focus-visible:ring-2");
    expect(pref).toContain("focus-within:ring-2");
    expect(dock).toContain("h-11 w-11");
  });
});
