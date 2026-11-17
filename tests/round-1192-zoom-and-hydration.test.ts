/**
 * R1192: the three site-wide items left open by the R1191 Live Assist pass.
 * 1. Pinch zoom works again (WCAG 1.4.4, axe critical on every page).
 * 2. The hydration warning on every page is gone: the browser hides a parsed nonce, so React saw nonce="".
 * 3. The 1163 axis-label assertion matched 12px after 1165 deliberately moved it to 13px.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (f: string) => readFileSync(f, "utf8");

describe("1192 zoom", () => {
  const l = src("app/layout.tsx");
  test("the viewport lets a reader pinch to 5x", () => {
    expect(l).toContain("maximumScale: 5");
    expect(l).toContain("userScalable: true");
    expect(l).not.toContain("userScalable: false");
    expect(l).not.toContain("maximumScale: 1");
  });
  test("width and the notch are unchanged, so no layout moves", () => {
    expect(l).toContain('width: "device-width"');
    expect(l).toContain("initialScale: 1");
    expect(l).toContain('viewportFit: "cover"');
  });
  test("the two zooms that felt like a bug are still off: double tap, and focusing a field", () => {
    const css = src("app/globals.css");
    expect(css).toContain("html { touch-action: manipulation;");
    const phone = css.slice(css.indexOf("/* Round 1 (1102): app-like touch."));
    expect(phone).toContain("@media (max-width: 767px)");
    expect(phone).toContain("font-size: max(16px, 1em) !important;");
  });
});

describe("1192 hydration", () => {
  const l = src("app/layout.tsx");
  const tags = l.match(/<script\b[^>]*>/g) ?? [];
  test("every inline head script still carries the nonce, so the CSP is unchanged", () => {
    expect(tags.length).toBeGreaterThanOrEqual(8);
    for (const t of tags) expect(t).toContain("nonce={nonce}");
  });
  test("and each one tells React not to compare that hidden attribute", () => {
    for (const t of tags) expect(t).toContain("suppressHydrationWarning");
  });
  test("the reason is written down next to it", () => {
    expect(l).toMatch(/hides a script's nonce attribute/);
  });
});

describe("1192 stale assertion", () => {
  test("the 1163 axis check now matches the 13px 1165 shipped", () => {
    const t = src("tests/round-1163-admin-kit.test.ts");
    expect(t).toContain('expect(c).toContain("fontSize: 13")');
    expect(t).not.toContain('expect(c).toContain("fontSize: 12")');
    expect(src("components/admin/OverviewCharts.tsx")).toContain("fontSize: 13");
  });
});
