/**
 * R1216: the phone top bar follows the scroll. One shared hook (lib/client/header-scroll.ts) used by the shared
 * bar, so every mobile route gets it; a transform-only fold so nothing shifts; desktop untouched.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SHOW_UNTIL, THRESHOLD } from "../lib/client/header-scroll";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const hook = src("lib/client/header-scroll.ts");
const nav = src("components/shell/Nav.tsx");
const css = src("app/globals.css");

describe("R1216 header scroll behaviour", () => {
  test("the shared bar uses the hook, keyed by the route, and exposes both states as attributes", () => {
    expect(nav).toContain('import { useHeaderScroll } from "@/lib/client/header-scroll";');
    expect(nav).toContain("const { lifted, hidden } = useHeaderScroll(path, bar);");
    expect(nav).toContain('data-lifted={lifted ? "" : undefined} data-folded={hidden ? "" : undefined} className="mtop web-only sticky top-0 z-30 lg:hidden"');
    // no per-page listeners anywhere else
    expect(nav).not.toContain("setLifted(window.scrollY");
  });
  test("direction with a threshold, always shown near the top, reset on a route change", () => {
    expect(THRESHOLD).toBeGreaterThanOrEqual(8);
    expect(SHOW_UNTIL).toBeGreaterThanOrEqual(52);
    expect(hook).toContain("if (top <= SHOW_UNTIL || typing || open) hidden = false;");
    expect(hook).toContain("else if (acc > THRESHOLD) hidden = true;");
    expect(hook).toContain("else if (acc < -THRESHOLD) hidden = false;");
    expect(hook).toContain("}, [resetKey]);");
  });
  test("nested scrollers are seen (capture), horizontal strips, dialogs and small lists are not", () => {
    expect(hook).toContain('document.addEventListener("scroll", onScroll, { passive: true, capture: true });');
    expect(hook).toContain("if (delta === 0) return;");
    expect(hook).toContain("t.clientHeight < innerHeight * 0.5 || t.scrollHeight <= t.clientHeight || t.closest(IGNORE)");
    expect(hook).toContain(`'[role="dialog"], [aria-modal="true"], [data-header-scroll="ignore"]'`);
    // the keyboard and the bell's open list keep the bar in place; tabbing into it brings it back
    expect(hook).toContain('active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable');
    expect(hook).toContain(`bar.current?.querySelector('[aria-expanded="true"]')`);
    expect(hook).toContain('b?.addEventListener("focusin", onFocus);');
  });
  test("a transform-only fold at 300ms on the liquid curve, no layout shift, reduced motion honoured", () => {
    expect(css).toMatch(/\.mtop \{[^}]*transform 0\.3s cubic-bezier\(0\.16, 1, 0\.3, 1\);/);
    expect(css).toContain(".mtop[data-folded] { transform: translateY(calc(-100% + env(safe-area-inset-top, 0px))); pointer-events: none; }");
    expect(css).toContain("@media (prefers-reduced-motion: reduce) { .mtop[data-folded] { transition: none; } }");
    // the tab bar is never hidden (1105/1211): only the top bar folds
    expect(css).not.toContain(".mtab[data-folded]");
    // the bar stays sticky in the flow (the content never gets a header-sized gap)
    expect(nav).toContain('className="mtop web-only sticky top-0 z-30 lg:hidden"');
  });
});
