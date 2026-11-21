/**
 * R1279: one safe-area system. The device insets are read once (--sa-* on :root) and every rule uses the tokens;
 * a status band paints the page colour behind the OS indicators; headers pad below them; side insets keep the
 * shell clear of a landscape notch; floats over the tab bar share one line.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");
const MARK = "/* ---------- 1100: Liquid glass on every studio card ----------";
const START = "/* R1279 safe area */";
const END = "/* end R1279 */";
const block = css.slice(css.indexOf(START), css.indexOf(END));
const rule = (sel: string) => {
  const i = css.indexOf(`\n${sel} {`);
  return i < 0 ? "" : css.slice(i, css.indexOf("\n}", i));
};
const TOKENS = [
  "--sa-t: env(safe-area-inset-top, 0px);",
  "--sa-b: env(safe-area-inset-bottom, 0px);",
  "--sa-l: env(safe-area-inset-left, 0px);",
  "--sa-r: env(safe-area-inset-right, 0px);",
  "--sa-float: calc(var(--sa-b) + 84px);",
];

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe("R1279 tokens", () => {
  test("the five tokens are defined once, on :root, in the R1279 block before the 1100 marker", () => {
    expect(css.split(START).length).toBe(2);
    expect(css.indexOf(END)).toBeLessThan(css.indexOf(MARK));
    expect(block).toContain(":root {\n  --sa-t:");
    for (const t of TOKENS) {
      expect(css.split(t).length).toBe(2);
      expect(block).toContain(t);
    }
  });
  test("nothing else in app, components or lib reads env(safe-area-inset-*)", () => {
    const hits: string[] = [];
    for (const f of ["app", "components", "lib"].flatMap((d) => walk(d))) {
      const n = src(f).split("env(safe-area-inset").length - 1;
      if (n) hits.push(`${f.replace(/\\/g, "/")}:${n}`);
    }
    expect(hits).toEqual(["app/globals.css:4"]);
  });
  test("the block moves nothing (no transform or transition)", () => {
    expect(block).not.toMatch(/transform|transition|translate|animation/);
    expect(css.slice(css.indexOf(MARK))).not.toContain(".sa-band");
  });
});

describe("R1279 status band", () => {
  test("mounted once in RootClient, hidden from assistive tech, no fake indicators", () => {
    const rc = src("components/shared/RootClient.tsx");
    expect(rc.split('<div className="sa-band" aria-hidden="true" />').length).toBe(2);
    expect(block).not.toMatch(/content:|::before|::after/);
  });
  test("fixed, the inset's height, takes no taps, frosted page colour", () => {
    const r = rule(".sa-band");
    expect(r).toContain("position: fixed; top: 0; left: 0; right: 0; z-index: 29; height: var(--sa-t); pointer-events: none;");
    expect(r).toContain("background: hsl(var(--background) / .84);");
    expect(r).toContain("-webkit-backdrop-filter: blur(18px) saturate(1.5);");
    expect(r).toContain("  backdrop-filter: blur(18px) saturate(1.5);");
  });
  test("solid under reduced transparency, forced colours and more contrast; hidden on the welcome screen", () => {
    expect(block).toContain("@media (prefers-reduced-transparency: reduce), (forced-colors: active) {\n  .sa-band { background: hsl(var(--background)); -webkit-backdrop-filter: none; backdrop-filter: none; }");
    expect(block).toContain('html[data-contrast="more"] .sa-band { background: hsl(var(--background));');
    expect(block).toContain("html[data-welcome] .sa-band");
  });
  test("one step under the shell headers (30), above page content", () => {
    expect(src("components/shell/Nav.tsx")).toContain('className="mtop web-only sticky top-0 z-30 lg:hidden"');
    expect(css).toContain("--admin-z-header: 30;");
  });
});

describe("R1279 headers", () => {
  test("phone headers pad by the top inset and fold to it", () => {
    expect(rule(".mtop")).toContain("padding-top: var(--sa-t);");
    expect(css).toContain(".mtop[data-folded] { transform: translateY(-100%); pointer-events: none; }");
    expect(css).toContain(".admin-top[data-folded] { transform: translateY(-100%); pointer-events: none; }");
    expect(src("components/admin/AdminShell.tsx")).toMatch(/admin-top sticky top-0[^"]* box-content [^"]*pt-\[var\(--sa-t\)\]/);
    expect(src("components/marketing/Nav.tsx")).toContain("mnav sticky top-0 z-50 pl-[max(0.75rem,var(--sa-l))] pr-[max(0.75rem,var(--sa-r))] pt-[calc(var(--sa-t)+0.75rem)]");
  });
  test("sticky bars inside a page stick below the status bar", () => {
    expect(src("components/create/JourneyRail.tsx")).toContain("glass sticky top-[var(--sa-t)] z-30");
    expect(src("app/mobile-app.css")).toContain("position: sticky; top: var(--sa-t); z-index: 35; margin-top: max(10px, var(--sa-t));");
  });
});

describe("R1279 sides", () => {
  test("top bar, tab bar and studio column keep clear of a landscape notch", () => {
    expect(rule(".mtop")).toContain("padding-left: var(--sa-l);\n  padding-right: var(--sa-r);");
    expect(rule(".mtab")).toContain("width: min(calc(100% - 2 * max(12px, var(--sa-l), var(--sa-r))), 440px);");
    expect(src("components/admin/AdminTabBar.tsx")).toContain('className="admin-tabbar mtab ');
    expect(block).toContain(".mmain { padding-left: var(--sa-l); padding-right: var(--sa-r); }");
  });
  test("admin header, content and drawer", () => {
    const shell = src("components/admin/AdminShell.tsx");
    expect(shell).toContain("pl-[max(1rem,var(--sa-l))] pr-[max(0.75rem,calc(var(--sa-r)+0.5rem))]"); // +0.5rem: the menu button (right, R1283) pulls itself in by -mr-2
    expect(shell).toContain("pl-[max(1rem,var(--sa-l))] pr-[max(1rem,var(--sa-r))] pt-2 sm:pl-[max(1.5rem,var(--sa-l))] sm:pr-[max(1.5rem,var(--sa-r))] lg:px-8");
    expect(shell).toContain("fixed bottom-[calc(var(--sa-b)+0.5rem)] right-[max(0.5rem,var(--sa-r))] top-[calc(var(--sa-t)+0.5rem)]");
  });
  test("drawer, sheet, toast, Pip, cookie banner, site bar", () => {
    const d = rule(".mdrawer");
    for (const s of ["top: var(--sa-t)", "right: var(--sa-r)", "bottom: var(--sa-b)"]) expect(d).toContain(`padding-${s};`);
    expect(src("components/shared/Sheet.tsx")).toContain("pb-[var(--sa-b)] pl-[var(--sa-l)] pr-[var(--sa-r)]");
    expect(src("components/shared/Toast.tsx")).toContain("pl-[max(1rem,var(--sa-l))] pr-[max(1rem,var(--sa-r))]");
    expect(src("components/support/ChatWidget.tsx")).toContain("fixed right-[max(1rem,var(--sa-r))] z-[55] sm:right-[max(1.5rem,var(--sa-r))]");
    expect(src("components/shared/CookieConsent.tsx")).toContain("left-[max(0.5rem,var(--sa-l))] right-[max(0.5rem,var(--sa-r))]");
    expect(src("components/shared/AdminSiteBar.tsx")).toContain("calc(100vw-1.5rem-var(--sa-l)-var(--sa-r))");
  });
});

describe("R1279 bottom", () => {
  test("what floats over the studio tab bar sits on --sa-float", () => {
    for (const f of ["components/shared/Toast.tsx", "components/create/ActionBar.tsx", "components/support/ChatWidget.tsx", "components/shared/CookieConsent.tsx", "components/shared/DeviceHint.tsx"])
      expect(src(f)).toContain("bottom-[var(--sa-float)]");
    expect(rule(".install-card")).toContain("bottom: var(--sa-float);");
  });
  test("the admin float line reads the bottom token", () => {
    expect(css).toContain(".admin-root { --admin-bottom-float: calc(var(--sa-b) + 84px); }");
    expect(src("components/admin/AdminShell.tsx")).toContain("pb-[calc(var(--sa-float)+1rem)]");
  });
  test("studio column and sheets clear the home indicator", () => {
    expect(src("app/(studio)/layout.tsx")).toContain("pb-[calc(var(--sa-b)+88px)] max-lg:[body:has([data-tabbar-off])_&]:pb-[var(--sa-b)]");
    expect(src("components/shared/Sheet.tsx")).toContain("bottom-0 rounded-t-[32px] pb-[var(--sa-b)]");
  });
});

describe("R1279 metadata", () => {
  test("one viewport: the root sets viewport-fit=cover, the public layout only overrides the theme colour", () => {
    const root = src("app/layout.tsx");
    expect(root.split("export async function generateViewport").length).toBe(2);
    expect(root).toContain('viewportFit: "cover"');
    expect(root).toContain("statusBarStyle: iosStatusBarStyle(theme)");
    expect(src("app/(marketing)/layout.tsx")).toMatch(/generateViewport\(\): Promise<Viewport> \{\n {2}return \{ themeColor: themeColorFor\([^\n]*\) \};/);
    const viewports = walk("app").filter((f) => /export (async function generateViewport|const viewport)/.test(src(f)));
    // R1290: the admin console (panel layout and sign-in) adds its own viewport to turn pinch zoom off; the merge keeps the root theme colour.
    expect(viewports.map((f) => f.replace(/\\/g, "/")).sort()).toEqual(["app/(marketing)/layout.tsx", "app/admin/(panel)/layout.tsx", "app/admin/login/page.tsx", "app/layout.tsx"]);
    for (const f of [...walk("app"), ...walk("components")].filter((f) => f.endsWith(".tsx")))
      expect(src(f)).not.toMatch(/<meta name="(viewport|theme-color)"/);
  });
  test("the manifest keeps standalone with the dark theme and background colours", () => {
    const m = src("app/manifest.ts");
    expect(m).toContain('display: "standalone"');
    expect(m).toContain("background_color: THEME_COLOR.dark");
    expect(m).toContain("theme_color: THEME_COLOR.dark");
  });
});
