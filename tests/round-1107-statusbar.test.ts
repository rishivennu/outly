/** 1107: the server sends the status bar colour of the saved theme, so a Home Screen app never shows a strip of another colour. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { THEME_COLOR, THEME_COOKIE, THEME_COOKIE_AGE, themeColorFor } from "@/lib/theme/colors";
import { THEME_KEY, themeScript } from "@/lib/theme/script";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("1107 status bar from the first byte", () => {
  test("each saved choice maps to the exact page background token", () => {
    expect(themeColorFor("light")).toBe(THEME_COLOR.light);
    expect(themeColorFor("dark")).toBe(THEME_COLOR.dark);
    expect(themeColorFor(undefined)).toBe(THEME_COLOR.dark); // Outlly's default theme
    const sys = [
      { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
      { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
    ];
    expect(themeColorFor("system")).toEqual(sys);
    expect(themeColorFor("junk")).toEqual(sys);
  });
  test("cookie and localStorage share one name; kept a year", () => {
    expect(THEME_COOKIE).toBe(THEME_KEY);
    expect(THEME_COOKIE_AGE).toBe(31536000);
  });
  test("the head script copies the saved choice into the cookie, so existing users carry over", () => {
    expect(themeScript).toContain("document.cookie='outly-theme='+t+';path=/;max-age=31536000;samesite=lax'");
    expect(themeScript).toContain("indexOf('outly-theme='+t)<0");
  });
  test("switching the theme writes the cookie before applying it", () => {
    const t = src("components/shared/ThemeToggle.tsx");
    const set = t.slice(t.indexOf("export function setTheme"), t.indexOf("export function useTheme"));
    expect(set.indexOf("document.cookie = `${THEME_COOKIE}=${choice};path=/;max-age=${THEME_COOKIE_AGE};samesite=lax")).toBeGreaterThan(0);
    expect(set.indexOf("document.cookie")).toBeLessThan(set.indexOf("apply(choice, true)"));
  });
  test("every page picks its theme-color from the cookie on the server (1108: root + public pages)", () => {
    const root = src("app/layout.tsx");
    expect(root).toContain("export async function generateViewport(): Promise<Viewport> {");
    expect(root).toContain("themeColor: themeColorFor((await cookies()).get(THEME_COOKIE)?.value)");
    const mkt = src("app/(marketing)/layout.tsx");
    expect(mkt).toContain('themeColor: themeColorFor((await cookies()).get(THEME_COOKIE)?.value, "sky")');
    expect(src("app/(studio)/layout.tsx")).not.toContain("generateViewport"); // the root one covers it
  });
  test("on phones the corner glows fade in below the top edge, so it is exactly the background", () => {
    const css = src("app/globals.css");
    expect(css).toMatch(/@media \(max-width: 1023\.98px\) \{\s*body::before \{\s*-webkit-mask-image: linear-gradient\(to bottom, transparent 0, #000 140px\);\s*mask-image: linear-gradient\(to bottom, transparent 0, #000 140px\);/);
  });
});
