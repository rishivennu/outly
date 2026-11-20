/**
 * R1260: opening the Command Palette on a scrolled desktop page must not move the sticky studio rail. Radix locks the
 * page with overflow:hidden on body; Lenis (desktop only) stops on that lock and its own rule hid html as well, which
 * made body a scroll box at scrollTop 0 and re-anchored the sticky rail to it. The invariant: while a dialog has
 * locked body, html under a stopped Lenis stays overflow:visible, so body keeps handing its overflow to the viewport.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");

describe("R1260 palette scroll lock keeps the rail in place", () => {
  test("a stopped Lenis leaves html visible while body is scroll-locked, right after its own hidden rule", () => {
    const hidden = css.indexOf(".lenis.lenis-stopped { overflow: hidden; }");
    const keep = css.indexOf("html.lenis.lenis-stopped:has(> body[data-scroll-locked]) { overflow: visible; }");
    expect(hidden).toBeGreaterThan(-1);
    expect(keep).toBeGreaterThan(hidden);
    // later rules must not hide html again under the lock
    expect(css.slice(keep + 1)).not.toMatch(/html[^{,]*lenis-stopped[^{]*\{[^}]*overflow:\s*(hidden|clip)/);
  });
  test("Lenis still stops on the same lock, so the page behind cannot drift", () => {
    const s = src("components/marketing/SmoothScroll.tsx");
    expect(s).toContain('body.hasAttribute("data-scroll-locked") ? l.stop() : l.start()');
    expect(s).not.toContain("autoToggle: true");
  });
  test("the rail is sticky to the viewport and stays untouched; the palette stays a real modal", () => {
    expect(src("components/shell/PulseRail.tsx")).toContain('className="rail-wrap sticky top-0 hidden h-dvh shrink-0 p-3 lg:block"');
    expect(css).not.toMatch(/\[data-scroll-locked\][^{]*\.rail(-wrap)?\b/);
    const p = src("components/shell/CommandPalette.tsx");
    expect(p).toContain("<Dialog.Root open={open} onOpenChange={setOpen}>");
    expect(p).not.toContain("modal={false}");
  });
});
