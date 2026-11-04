import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (f: string) => readFileSync(join(import.meta.dir, "..", f), "utf8").replace(/\r\n/g, "\n");
const nav = src("components/marketing/Nav.tsx");
const live = src("components/shared/LiveCount.tsx");
const theme = src("components/shared/ThemeToggle.tsx");
const css = src("app/globals.css");

describe("1117 one-row website bar", () => {
  test("order: logo, links, live count, theme, CTA", () => {
    const at = (s: string) => nav.indexOf(s);
    const order = [at("<OutlyLogo"), at('<nav ref={navRef} aria-label="Sections"'), at("<LiveCount nav"), at("<ThemeToggle compact dense"), at('href="/home"')];
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("the live count is one short line: creators, a dot, online", () => {
    expect(live).toContain("nav = false");
    expect(live).toContain('className="lc-total');
    expect(live).toContain('className="lc-sep');
    expect(live).toContain('className="lc-online');
    expect(live).toMatch(/<Num n=\{v\.total\} format=\{compactCount\} \/> creators<\/span>/);
    expect(live).toMatch(/<Num n=\{v\.online\} format=\{compactCount\} \/> online<\/span>/);
    expect(nav).not.toContain("2xl:inline-flex");
  });

  test("when space runs short the count steps down before the links crowd", () => {
    expect(nav).toContain('const FIT_STEPS = ["full", "online", "none"] as const;');
    expect(nav).toContain("bar.dataset.fit = step;");
    expect(nav).toContain("new ResizeObserver(fit)");
    expect(nav).toContain("new MutationObserver(fit)");
    expect(css).toContain('.mnav-bar[data-fit="online"] .lc-total, .mnav-bar[data-fit="online"] .lc-sep, .mnav-bar[data-fit="none"] .mnav-live { display: none; }');
  });

  test("every group stays on one row (nothing shrinks into a wrap)", () => {
    expect(nav).toMatch(/mnav-end ml-auto flex shrink-0 items-center/);
    expect(nav).toMatch(/className="mx-auto hidden shrink-0 lg:block"/);
    expect(live).toMatch(/lc-nav inline-flex[^"]*whitespace-nowrap/);
  });

  test("gaps and link padding scale with the viewport on desktop", () => {
    expect(css).toMatch(/\.mnav \.mnav-bar \{ gap: clamp\(/);
    expect(css).toMatch(/\.mnav-link \{ padding: 0 clamp\(/);
  });

  test("dense theme switcher keeps a 36px hit area", () => {
    expect(theme).toContain("dense = false");
    expect(theme).toContain('dense ? "relative h-8 w-9 before:absolute before:-inset-y-0.5');
    expect(theme).toContain('dense ? "p-0.5" : "p-1"');
  });

  test("focus in the bar is lime, never the purple ring", () => {
    expect(css).toContain(".mnav-bar :focus-visible, .np-panel :focus-visible { outline-color: hsl(var(--lime)); }");
    expect(css).toContain("html:not(.dark) .mnav-bar :focus-visible, html:not(.dark) .np-panel :focus-visible { outline-color: hsl(var(--lime-ink)); }");
  });
});
