import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THEME_COLOR, statusBarColor, themeColorFor } from "@/lib/theme/colors";
import { themeScript } from "@/lib/theme/script";
import { opaqueHex } from "@/lib/theme/statusbar";

const src = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8").replace(/\r\n/g, "\n");
// the browser's hsl() -> 8-bit rgb, the same rounding Chromium and WebKit use
function hslRgb(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)];
}
const hexRgb = (x: string) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));

describe("1108 status bar on every surface, iPhone and Android", () => {
  test("lightSky is exactly the public pages' light --background", () => {
    const m = src("app/globals.css").match(/html:not\(\.dark\) body:has\(\.sky-host\) \{ --background: (\d+) (\d+)% ([\d.]+)%;/)!;
    expect(hexRgb(THEME_COLOR.lightSky)).toEqual(hslRgb(+m[1], +m[2], +m[3]));
  });
  test("statusBarColor and themeColorFor pick the surface's own light colour", () => {
    expect(statusBarColor(true, "sky")).toBe(THEME_COLOR.dark);
    expect(statusBarColor(false, "sky")).toBe(THEME_COLOR.lightSky);
    expect(statusBarColor(false)).toBe(THEME_COLOR.light);
    expect(themeColorFor("light", "sky")).toBe(THEME_COLOR.lightSky);
    expect(themeColorFor("dark", "sky")).toBe(THEME_COLOR.dark);
    expect(themeColorFor("system", "sky")).toEqual([
      { media: "(prefers-color-scheme: light)", color: THEME_COLOR.lightSky },
      { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
    ]);
  });
  test("head script: surface from the server's colour, then .sky-host once the body exists; Android bar icons", () => {
    expect(themeScript).toContain(`sky=[].some.call(q(),function(m){return m.getAttribute('content')==='${THEME_COLOR.lightSky}'})`);
    expect(themeScript).toContain("document.addEventListener('DOMContentLoaded',function(){pick(!!document.querySelector('.sky-host'));tc()})");
    expect(themeScript).toContain("C.nativePromise('SystemBars','setStyle',{style:d?'DARK':'LIGHT'})");
  });
  test("one sync after every page change, and it drives meta + Capacitor SystemBars", () => {
    expect(src("app/layout.tsx")).toContain("<StatusBarSync />");
    const sync = src("components/shared/StatusBarSync.tsx");
    expect(sync).toContain("syncStatusBar();");
    expect(sync).toContain("}, [path]);");
    const sb = src("lib/theme/statusbar.ts");
    expect(sb).toContain('statusBarColor(dark, document.querySelector(".sky-host") ? "sky" : "app")');
    expect(sb).toContain('const style = dark ? "DARK" : "LIGHT";');
    expect(sb).toContain('cap.nativePromise("SystemBars", "setStyle", { style })');
    expect(src("components/shared/ThemeToggle.tsx")).toContain("syncStatusBar(dark);");
  });
  test("while the first-launch welcome is up the bar takes its colour, read off the screen", () => {
    expect(opaqueHex("rgb(248, 246, 241)")).toBe("#f8f6f1");
    expect(opaqueHex("rgba(12, 12, 14, 1)")).toBe("#0c0c0e");
    expect(opaqueHex("rgba(0, 0, 0, 0)")).toBeNull();
    expect(opaqueHex("rgba(10, 10, 10, 0.5)")).toBeNull();
    const sb = src("lib/theme/statusbar.ts");
    expect(sb).toContain('const color = welcomeColor() ?? statusBarColor(');
    const sync = src("components/shared/StatusBarSync.tsx");
    expect(sync).toContain('mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-welcome"] });');
    expect(sync).toContain("return () => mo.disconnect();");
  });
  test("iPhone Home Screen app reloads after a switch that changes the colour, once the cross-fade ends", () => {
    const t = src("components/shared/ThemeToggle.tsx");
    const set = t.slice(t.indexOf("export function setTheme"), t.indexOf("export function useTheme"));
    expect(set).toContain("if (isIosHomeScreenApp() && document.documentElement.dataset.tc !== before) {");
    expect(set).toContain("window.setTimeout(() => window.location.reload(), THEME_SWITCH_MS + 60);");
    expect(set.indexOf("document.cookie")).toBeLessThan(set.indexOf("location.reload"));
    expect(src("lib/theme/statusbar.ts")).toContain("standalone === true");
  });
});
