/** 1105: status bar in step with the theme, one coordinated theme switch, and the refined phone top and tab bars. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { iosStatusBarStyle, THEME_COLOR, THEME_SWITCH_MS } from "@/lib/theme/colors";
import { themeScript } from "@/lib/theme/script";
import { pageTitle } from "@/components/shell/nav-items";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");
const nav = src("components/shell/Nav.tsx");
const bar = nav.slice(nav.indexOf("export function MobileTopBar"));
const tabs = nav.slice(nav.indexOf("export function MobileNav"), nav.indexOf("export function MobileTopBar"));
const theme = src("components/shared/ThemeToggle.tsx");
const rule = (sel: string) => {
  const i = css.indexOf(`\n${sel} {`);
  expect(i).toBeGreaterThan(0);
  return css.slice(i, css.indexOf("}", i));
};

function hslHex(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return [f(0), f(8), f(4)];
}
const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

describe("1105 status bar colour", () => {
  test("THEME_COLOR is exactly the --background token of each theme, as the browser renders it", () => {
    const tokens = [...css.matchAll(/--background: (\d+) (\d+)% (\d+)%;/g)].slice(0, 2).map((m) => hslHex(+m[1], +m[2], +m[3]));
    const [light, dark] = tokens;
    expect(hexRgb(THEME_COLOR.light)).toEqual(light!); // rgb(245, 247, 249), measured in Edge and on the iPhone screenshot
    expect(hexRgb(THEME_COLOR.dark)).toEqual(dark!); // rgb(12, 12, 14)
  });
  test("the head script sets theme-color for the saved theme before paint", () => {
    expect(themeScript).toContain(`meta[name="theme-color"]`);
    expect(themeScript).toContain(`e.dataset.tc=d?'${THEME_COLOR.dark}':s?'${THEME_COLOR.lightSky}':'${THEME_COLOR.light}'`);
    // Next adds a second tag after hydration: the observer holds every one to html[data-tc]
    expect(themeScript).toContain("new MutationObserver(tc).observe(document.head,{childList:true,subtree:true,attributes:true,attributeFilter:['content']})");
    expect(themeScript).toContain("if(m.getAttribute('content')!==e.dataset.tc)");
  });
  test("no hard-coded status bar colour anywhere else", () => {
    const layout = src("app/layout.tsx");
    expect(layout).toContain("themeColor: themeColorFor((await cookies()).get(THEME_COOKIE)?.value)");
    // R1215: the style follows the saved theme (dark runs under the bar, light keeps iOS's default strip)
    expect(layout).toContain("statusBarStyle: iosStatusBarStyle(theme)");
    expect(layout).toContain("const theme = (await cookies()).get(THEME_COOKIE)?.value;");
    expect(iosStatusBarStyle("dark")).toBe("black-translucent");
    expect(iosStatusBarStyle(undefined)).toBe("black-translucent");
    expect(iosStatusBarStyle("light")).toBe("default");
    expect(iosStatusBarStyle("system")).toBe("default");
    expect(layout).toContain('"apple-mobile-web-app-capable": "yes"');
    expect(layout).toContain('viewportFit: "cover"');
    const manifest = src("app/manifest.ts");
    expect(manifest).toContain('display: "standalone"');
    expect(manifest).toContain("theme_color: THEME_COLOR.dark");
    for (const f of ["app/layout.tsx", "app/manifest.ts", "components/shared/ThemeToggle.tsx", "lib/theme/script.ts"]) expect(src(f)).not.toMatch(/#0c0c0e|#f5f7fa|#0d0d10/i);
  });
});

describe("1105 theme switch", () => {
  test("status bar first, then one 400ms cross-fade; instant on first paint and under reduced motion", () => {
    expect(THEME_SWITCH_MS).toBe(400);
    const apply = theme.slice(theme.indexOf("function apply("), theme.indexOf("export const THEME_EVENT"));
    expect(apply.indexOf("theme-color")).toBeLessThan(apply.indexOf("startViewTransition"));
    expect(apply).toContain('if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return paint();');
    expect(apply).toContain('if (el.classList.contains("dark") === dark) return;');
    expect(apply).toContain("t.finished.then(done, done);");
    expect(apply).toContain("t.ready.catch(() => {});");
    expect(theme).toContain("apply(choice, true);");
    expect(theme).toContain('apply("system", true)');
    expect(css).toMatch(/html\[data-theme-switch\]::view-transition-new\(root\) \{\s*animation-duration: 400ms;\s*animation-timing-function: var\(--m-ease-out\);/); // 1119 token, same curve
  });
  test("fallback transitions colour properties only", () => {
    const fb = css.slice(css.indexOf("html.theme-anim *::after {"), css.indexOf("}", css.indexOf("html.theme-anim *::after {")));
    expect(fb).toContain("transition-property: background-color, color, border-color, outline-color, text-decoration-color, fill, stroke !important;");
    expect(fb).toContain("transition-duration: .4s !important;");
    expect(fb).not.toMatch(/transform|opacity|box-shadow|width|height/);
  });
});

describe("1105 phone top bar", () => {
  test("logo left, section title centre, bell and menu right; nothing else", () => {
    expect(bar).toContain("grid-cols-[1fr_auto_1fr]");
    const logo = bar.indexOf("<OutlyLogo"), title = bar.indexOf("mtop-title"), bell = bar.indexOf("<NoticesBell"), menu = bar.indexOf("<MobileDrawer");
    expect(logo).toBeGreaterThan(0);
    expect(logo).toBeLessThan(title);
    expect(title).toBeLessThan(bell);
    expect(bell).toBeLessThan(menu);
    for (const gone of ["<PaletteButton", "<ThemeCycleButton", "<LiveCount"]) expect(bar).not.toContain(gone);
    expect(bar).toContain("key={title}");
    expect(bar).toContain("truncate");
  });
  test("titles follow the route, children use their section", () => {
    expect(pageTitle("/home")).toBe("Home");
    expect(pageTitle("/analytics/instagram")).toBe("Analytics");
    expect(pageTitle("/calendar")).toBe("Calendar");
    expect(pageTitle("/inbox")).toBe("Inbox");
    expect(pageTitle("/settings")).toBe("Settings");
    expect(pageTitle("/creator")).toBe("");
  });
  test("timings: entrance 350ms, title 250ms, icons 150ms, drawer 350ms, notices 250ms", () => {
    expect(css).toContain(".mtop-row { animation: mtop-in .35s var(--ease-liquid) backwards; }");
    expect(css).toContain(".mtop-title { animation: mtop-title-in .25s var(--ease-liquid) backwards; }");
    expect(rule(".mtop-btn")).toContain("transform 0.15s var(--ease-liquid)");
    // 1119: the drawer opens at the nav token (300ms) and leaves faster than it came (menu, ease-in).
    expect(css).toContain('.mdrawer[data-state="open"] { animation: mdrawer-in var(--m-nav) var(--m-ease-out); }');
    // R1255: and closes in half that time.
    expect(css).toContain('.mdrawer[data-state="closed"] { animation: mdrawer-out calc(var(--m-nav) / 2) var(--m-ease-in) forwards; }');
    // R1255: the notices panel is tweened by GSAP from its bell (usePanelPresence), 200ms in and 100ms out.
    expect(css).toContain(".notice-panel { transform-origin: top right; }");
    expect(src("components/shell/NoticesBell.tsx")).toContain("usePanelPresence(open, panel,");
  });
  test("the drawer keeps search (moved off the bar) and opens it after it has gone", () => {
    const drawer = src("components/shell/MobileDrawer.tsx");
    // 1154: the Workspace section opens with a plain "Search" row.
    expect(drawer).toMatch(/<Search [^>]*\/>\s*<span className="min-w-0 flex-1 truncate">Search<\/span>/);
    expect(drawer).toMatch(/if \(searching\.current\) \{\s*e\.preventDefault\(\);\s*searching\.current = false;\s*openPalette\(\);/);
  });
  test("the notices panel never runs past a short phone", () => {
    const bell = src("components/shell/NoticesBell.tsx");
    expect(bell).toContain('document.querySelector("nav.mtab")?.getBoundingClientRect()');
    expect(bell).toContain("maxHeight: Math.max(200, Math.min(520, floor - r.bottom - 8))");
  });
});

describe("1105 tab bar", () => {
  test("same five tabs on a lighter pill, equal widths, no liquid glass", () => {
    expect(nav).toContain('const TABS = ["/home", "/create", "/calendar", "/inbox", "/analytics"];');
    // 1115 docked it full width; 11-19 it floats again: the 60px height and the 440px cap live in .mtab (globals.css).
    expect(tabs).toContain("fixed inset-x-0 z-40");
    expect(tabs).not.toContain("max-w-[480px]");
    expect(rule(".mtab")).toContain("height: 60px;");
    expect(rule(".mtab")).toContain("var(--sa-r))), 440px);");
    expect(tabs).not.toContain("lg-glass");
    expect(tabs).toContain("min-w-0 flex-1");
    expect(tabs).toContain('strokeWidth={2}');
  });
  test("active: lime pill, dark icon (11-19: icons only, the label is for screen readers); timings 250 / 300 / 150 / 400", () => {
    // R1213: one .mtab-ind for the whole bar, slid along by --i (tests/round-1213-liquid-tabs.test.ts)
    expect(css).toContain(".mtab[data-none]:not([data-drag]) .mtab-ind { opacity: 0; }");
    expect(css).toContain(".mtab-item[aria-current] .mtab-pill > svg { color: hsl(var(--lime-foreground)); }");
    expect(css).not.toContain(".mtab-label");
    expect(tabs).toContain('<span className="sr-only">{label}</span>');
    expect(css).toContain("transition: color .25s var(--ease-liquid); }");
    expect(rule(".mtab-ind")).toContain("translate .35s var(--ease-liquid)");
    expect(rule(".mtab-pill")).toContain("transform .15s var(--ease-liquid)");
    expect(css).toContain(".mtab { animation: mtab-in .4s var(--ease-liquid) backwards; }");
  });
  test("safe area at the bottom, page padding clears it, solid when asked", () => {
    expect(rule(".mtab")).toContain("bottom: calc(var(--sa-b) + 12px);");
    expect(src("app/(studio)/layout.tsx")).toContain("pb-[calc(var(--sa-b)+88px)]");
    expect(css).toContain('html[data-contrast="more"] .mtab { background: hsl(var(--card));');
  });
  test("compacts scrolling down a long page (11-19; it used to hide), back on scroll up, top, end, route change and short pages", () => {
    const hook = nav.slice(nav.indexOf("function useCompactOnScroll"), nav.indexOf("export function MobileNav"));
    expect(hook).toContain("setCompact(false);\n    s.current = { y: window.scrollY, run: 0, compact: false };\n  }, [path]);");
    expect(hook).toContain("new ResizeObserver(onScroll)");
    expect(hook).toContain('matches("input, textarea, select, [contenteditable]")');
    expect(tabs).not.toContain("onFocusCapture");
    // never hidden, never inert: the bar stays on screen and in the tab order in both states
    expect(tabs).not.toContain("inert=");
    expect(tabs).not.toContain("data-hidden");
    expect(css).not.toContain(".mtab[data-hidden]");
    expect(hook).toContain("{ passive: true }");
  });
});

describe("1105 review fixes", () => {
  test("tab bar tint (R1213 glass): 62 to 72% of the surface so the 72% ink holds 4.5:1 over the page and 3:1 over anything behind", () => {
    expect(css).toMatch(/html\.dark \.mtab \{\r?\n  --mtab-bg: 240 5% 11%; --mtab-line: 0 0% 100% \/ \.1;/);
    expect(rule(".mtab")).toContain("--mtab-bg: 0 0% 100%;");
    expect(rule(".mtab")).toContain("hsl(var(--mtab-bg) / .72)");
    expect(css).toContain(".mtab-item { color: hsl(var(--foreground) / .72);");
  });
  test("only the latest theme switch clears the transition flag", () => {
    expect(theme).toContain("const n = ++seq;");
    expect(theme).toContain("if (n === seq) delete el.dataset.themeSwitch;");
  });
  test("banners above the top bar clear the notch themselves", () => {
    expect(src("components/shell/WorkspaceBar.tsx")).toContain('className="mtop-pre ');
    expect(src("app/(studio)/layout.tsx")).toContain('className="mtop-pre ');
    expect(css).toContain(".mtop-pre:first-child { padding-top: calc(var(--sa-t) + 0.5rem); }");
  });
  test("things that float above the tab bar sit 12px over its top edge", () => {
    const over = "var(--sa-float)";
    for (const f of ["components/shared/CookieConsent.tsx", "components/shared/DeviceHint.tsx", "components/support/ChatWidget.tsx", "components/shared/Toast.tsx"]) {
      const s = src(f);
      expect(s).toContain(over);
      expect(s).not.toMatch(/bottom-\[9[26]px\]/);
    }
    expect(rule(".install-card")).toContain("bottom: var(--sa-float);");
    expect(css).toContain(".install-card { bottom: calc(var(--sa-b) + 74px); }");
  });
  test("head script reads the contrast key from its constant", () => {
    expect(themeScript).toContain("localStorage.getItem('outly-contrast-v2')");
    expect(src("lib/theme/script.ts")).toContain("localStorage.getItem('${CONTRAST_KEY}')");
  });
});
