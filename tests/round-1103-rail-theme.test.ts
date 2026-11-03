/** 1103 (Round 2): one rail for every dashboard style, following the page theme, with a visible theme control. */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const rail = src("components/shell/PulseRail.tsx");
const nav = src("components/shell/Nav.tsx");
const theme = src("components/shared/ThemeToggle.tsx");
const css = src("app/globals.css");
const railCss = css.slice(css.indexOf(".rail {"), css.indexOf("/* Rail tooltips"));

describe("1103 rail follows the theme", () => {
  test("no forced dark island, logo follows the theme", () => {
    expect(rail).toContain('className="rail lg-glass"');
    expect(rail).not.toMatch(/className="rail[^"]*\bdark\b/);
    expect(rail).not.toContain('tone="dark"');
  });
  test("light is glass, dark keeps the shipped ink rail without rim or sheen", () => {
    expect(railCss).toMatch(/\.rail \{\s*--rail-bg: hsl\(var\(--glass-solid\)\);/);
    expect(railCss.slice(0, railCss.indexOf("}"))).not.toContain("background:");
    expect(railCss).toContain("html.dark .rail { --rail-bg: hsl(240 5% 10.5%); background: var(--rail-bg);");
    expect(railCss).toContain("html.dark .rail::before, html.dark .rail::after { display: none; }");
  });
  test("no hard-coded ink inside the rail; focus uses the theme ring", () => {
    expect(railCss).not.toContain("232 16% 7%");
    expect(railCss).toContain(".rail-row:focus-visible { box-shadow: 0 0 0 2px hsl(var(--ring));");
    expect(railCss).toContain("0 0 0 2px var(--rail-bg), 0 0 0 4px hsl(var(--ring))");
  });
  test("New post: lime-ink in light for contrast, and focus adds to its outline", () => {
    expect(railCss).toContain('html:not(.dark) .rail-new:not([aria-current="page"]) { color: hsl(var(--lime-ink));');
    expect(railCss).toMatch(/\.rail-new:not\(\[aria-current="page"\]\):focus-visible \{ box-shadow: inset[^}]*0 0 0 2px hsl\(var\(--ring\)\)/);
  });
});

describe("1103 theme control", () => {
  test("rail: cycle button collapsed, three-way switch open; the hidden one is display:none", () => {
    expect(rail).toContain("<RailTheme />");
    expect(rail).toContain('className="rail-row rail-theme-cycle"');
    expect(rail).toContain("aria-label={`Theme: ${cur.label}. Switch to ${nxt.label}`}");
    expect(rail).toContain("<ThemeToggle compact plain");
    expect(railCss).toMatch(/\.rail-theme \{ display: none;/);
    expect(railCss).toContain('html[data-rail="open"] .rail-theme { display: flex; }');
    expect(railCss).toContain('html[data-rail="open"] .rail-theme-cycle { display: none; }');
  });
  test("phone top bar: bell then menu (1105 moved the theme switch into the drawer and retired ThemeCycleButton)", () => {
    const bar = nav.slice(nav.indexOf("export function MobileTopBar"));
    const j = bar.indexOf("<NoticesBell"), k = bar.indexOf("<MobileDrawer");
    expect(bar).not.toContain("<ThemeCycleButton");
    expect(j).toBeGreaterThan(0);
    expect(j).toBeLessThan(k);
    expect(theme).not.toContain("export function ThemeCycleButton");
  });
  test("every control stays in step: one setter, an event, and other tabs", () => {
    expect(theme).toContain('export const THEME_EVENT = "outlly:theme";');
    expect(theme).toContain("window.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_EVENT");
    expect(theme).toContain("window.addEventListener(THEME_EVENT, onSet)");
    expect(theme).toContain('window.addEventListener("storage", onStore)');
    expect(theme).toContain("return { choice, set: setTheme };");
    const palette = src("components/shell/CommandPalette.tsx");
    expect(palette).toContain('import { setTheme } from "@/components/shared/ThemeToggle";');
    expect(palette).not.toContain("applyTheme");
  });
});

describe("1103 one sidebar", () => {
  test("Sidebar takes no style; the layout no longer loads the dashboard style for it", () => {
    expect(nav).toMatch(/export function Sidebar\(\)\s*\{\s*return <PulseRail \/>;\s*\}/);
    expect(existsSync("components/shell/ClassicSidebar.tsx")).toBe(false);
    const layout = src("app/(studio)/layout.tsx");
    expect(layout).toContain("<Sidebar />");
    expect(layout).not.toContain("dashboardFor");
  });
  test("rail scroll: slim scrollbar only while open", () => {
    expect(rail).toContain('className="rail-mid nav-scroll"');
    expect(css).toMatch(/\.rail-mid \{[^}]*scrollbar-width: none/);
    expect(css).toContain('html[data-rail="open"] .rail-mid.nav-scroll { scrollbar-width: thin; }');
  });
  test("admin picker no longer promises a different sidebar", () => {
    const picker = src("components/admin/DashboardStylePicker.tsx");
    expect(picker).not.toContain("Sidebar as it was");
    expect(picker).not.toContain("Animated sidebar icons");
  });
});

describe("1103 rail scroll edge", () => {
  test("fade only when the list scrolls, driven by its own scroll position", () => {
    expect(css).toContain("@supports (animation-timeline: scroll())");
    expect(css).toContain("animation: rail-fade linear both; animation-timeline: scroll(self);");
    expect(css).toMatch(/@property --rail-fade-t \{[^}]*initial-value: 0px/);
  });
});

describe("1103 review fixes", () => {
  test("dark rail skips the refraction filter, and high contrast keeps its edge", () => {
    expect(railCss).toContain('html.dark[data-lg] .rail.lg-glass[data-lg-ready] { -webkit-backdrop-filter: none; backdrop-filter: none; }');
    expect(railCss).toContain('html.dark[data-contrast="more"] .rail { box-shadow: inset 0 0 0 1px hsl(var(--border)); }');
    expect(railCss).toMatch(/html\.dark \.rail \{[^}]*box-shadow: var\(--tw-ring-offset-shadow/);
  });
  test("theme radios: one Tab stop, arrows and Home/End move the choice", () => {
    expect(theme).toContain("tabIndex={on ? 0 : -1}");
    expect(theme).toContain("onKeyDown={onKeyDown}");
    for (const k of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"]) expect(theme).toContain(k);
  });
  test("the stored theme is read before paint", () => {
    expect(theme).toMatch(/useLayoutEffect\(\(\) => setChoice\(\(document\.documentElement\.dataset\.theme/);
  });
  test("open theme row fits 204px: 8px inset, 4px gap, switch never shrinks", () => {
    expect(railCss).toMatch(/\.rail-theme \{[^}]*gap: 4px;[^}]*padding-left: 8px;/);
    expect(rail).toContain('<ThemeToggle compact plain className="shrink-0" />');
  });
  test("palette panel no longer springs", () => {
    expect(src("components/shell/CommandPalette.tsx")).not.toMatch(/type: "spring"/);
  });
});
