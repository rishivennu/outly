/** 1105: status bar in step with the theme, one coordinated theme switch, and the refined phone top and tab bars. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { THEME_COLOR, THEME_SWITCH_MS } from "@/lib/theme/colors";
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
  test("THEME_COLOR is the --background token of each theme (within 1 per channel)", () => {
    const tokens = [...css.matchAll(/--background: (\d+) (\d+)% (\d+)%;/g)].slice(0, 2).map((m) => hslHex(+m[1], +m[2], +m[3]));
    const [light, dark] = tokens;
    hexRgb(THEME_COLOR.light).forEach((v, i) => expect(Math.abs(v - light![i]!)).toBeLessThanOrEqual(1));
    hexRgb(THEME_COLOR.dark).forEach((v, i) => expect(Math.abs(v - dark![i]!)).toBeLessThanOrEqual(1));
  });
  test("the head script sets theme-color for the saved theme before paint", () => {
    expect(themeScript).toContain(`meta[name="theme-color"]`);
    expect(themeScript).toContain(`e.dataset.tc=d?'${THEME_COLOR.dark}':'${THEME_COLOR.light}'`);
    // Next adds a second tag after hydration: the observer holds every one to html[data-tc]
    expect(themeScript).toContain("new MutationObserver(tc).observe(document.head,{childList:true,subtree:true,attributes:true,attributeFilter:['content']})");
    expect(themeScript).toContain("if(m.getAttribute('content')!==e.dataset.tc)");
  });
  test("no hard-coded status bar colour anywhere else", () => {
    const layout = src("app/layout.tsx");
    expect(layout).toContain("themeColor: THEME_COLOR.dark");
    expect(layout).toContain('statusBarStyle: "default"');
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
    expect(css).toMatch(/html\[data-theme-switch\]::view-transition-new\(root\) \{\s*animation-duration: 400ms;\s*animation-timing-function: cubic-bezier\(\.16, 1, \.3, 1\);/);
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
    expect(css).toContain('.mdrawer[data-state="open"] { animation: mdrawer-in .35s var(--ease-liquid); }');
    expect(css).toContain('.mdrawer[data-state="closed"] { animation: mdrawer-out .35s var(--ease-liquid) forwards; }');
    expect(css).toContain(".notice-panel { animation: np-in .25s var(--ease-liquid); transform-origin: top right; }");
  });
  test("the drawer keeps search (moved off the bar) and opens it after it has gone", () => {
    const drawer = src("components/shell/MobileDrawer.tsx");
    expect(drawer).toContain("Search or jump");
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
    expect(tabs).toContain("h-[62px]");
    expect(tabs).toContain("rounded-full");
    expect(tabs).toContain("max-w-[480px]");
    expect(tabs).not.toContain("lg-glass");
    expect(tabs).toContain("min-w-0 flex-1");
    expect(tabs).toContain("whitespace-nowrap");
    expect(tabs).toContain('strokeWidth={2}');
  });
  test("active: lime pill, dark icon, semibold label; timings 250 / 300 / 150 / 200 / 400", () => {
    expect(css).toContain(".mtab-item[aria-current] .mtab-ind { opacity: 1; transform: none; }");
    expect(css).toContain(".mtab-item[aria-current] .mtab-pill > svg { color: hsl(var(--lime-foreground)); }");
    expect(css).toContain(".mtab-item[aria-current] .mtab-label { font-weight: 650; }");
    expect(css).toContain("transition: color .25s var(--ease-liquid); }");
    expect(rule(".mtab-ind")).toContain("transform .3s var(--ease-liquid)");
    expect(rule(".mtab-pill")).toContain("transform .15s var(--ease-liquid)");
    expect(rule(".mtab-label")).toContain("color .2s var(--ease-liquid)");
    expect(css).toContain(".mtab { animation: mtab-in .4s var(--ease-liquid) backwards; }");
  });
  test("safe area at the bottom, page padding clears it, solid when asked", () => {
    expect(rule(".mtab")).toContain("bottom: max(12px, env(safe-area-inset-bottom));");
    expect(src("app/(studio)/layout.tsx")).toContain("pb-[calc(max(12px,env(safe-area-inset-bottom))+88px)]");
    expect(css).toContain('html[data-contrast="more"] .mtab { background: hsl(var(--card));');
  });
  test("tucks away scrolling down a long page, back on scroll up, top, end, route change and short pages", () => {
    const hook = nav.slice(nav.indexOf("function useTuckOnScroll"), nav.indexOf("export function MobileNav"));
    expect(hook).toContain("setHidden(false);\n    last.current = window.scrollY;\n    run.current = 0;\n  }, [path]);");
    expect(hook).toContain("new ResizeObserver(onScroll)");
    expect(hook).toContain('matches("input, textarea, select, [contenteditable]")');
    // hidden means out of the tab order too, so no focus hook is needed
    expect(tabs).not.toContain("onFocusCapture");
    expect(tabs).toContain("inert={hidden}");
    expect(css).toMatch(/\.mtab\[data-hidden\] \{[^}]*visibility: hidden;[^}]*visibility 0s \.3s;/);
    expect(hook).toContain("still.matches || end < window.innerHeight * 0.75 || y < 80 || end - y < 80");
    expect(hook).toContain("{ passive: true }");
    expect(css).toMatch(/\.mtab\[data-hidden\] \{[^}]*pointer-events: none;/);
  });
});

describe("1105 review fixes", () => {
  test("dark tab bar is frosted at 88% so muted labels hold 4.5:1 over a white card behind", () => {
    expect(css).toContain("html.dark .mtab { --mtab-bg: 240 5% 10.5% / .88;");
  });
  test("only the latest theme switch clears the transition flag", () => {
    expect(theme).toContain("const n = ++seq;");
    expect(theme).toContain("if (n === seq) delete el.dataset.themeSwitch;");
  });
  test("banners above the top bar clear the notch themselves", () => {
    expect(src("components/shell/WorkspaceBar.tsx")).toContain('className="mtop-pre ');
    expect(src("app/(studio)/layout.tsx")).toContain('className="mtop-pre ');
    expect(css).toContain(".mtop-pre:first-child { padding-top: calc(env(safe-area-inset-top) + 0.5rem); }");
  });
  test("things that float above the tab bar sit 12px over its top edge", () => {
    const over = "calc(max(12px,env(safe-area-inset-bottom))+74px)";
    for (const f of ["components/shared/CookieConsent.tsx", "components/shared/DeviceHint.tsx", "components/support/ChatWidget.tsx"]) {
      const s = src(f);
      expect(s).toContain(over);
      expect(s).not.toMatch(/bottom-\[9[26]px\]/);
    }
    expect(rule(".install-card")).toContain("bottom: calc(max(12px, env(safe-area-inset-bottom)) + 74px);");
    expect(css).toContain(".install-card { bottom: calc(max(12px, env(safe-area-inset-bottom)) + 66px); }");
  });
  test("head script reads the contrast key from its constant", () => {
    expect(themeScript).toContain("localStorage.getItem('outly-contrast')");
    expect(src("lib/theme/script.ts")).toContain("localStorage.getItem('${CONTRAST_KEY}')");
  });
});
