import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync("app/globals.css", "utf8");
const reveal = readFileSync("lib/motion/reveal.ts", "utf8");

describe("motion pass (1064)", () => {
  test("headings rise through a line mask, no elastic unfold", () => {
    expect(css).toContain("@keyframes sw-rise");
    expect(css).not.toContain("sw-unfold");
    expect(css).not.toContain("sw-hop");
    expect(css).not.toMatch(/\.rv-words \.sw[^}]*--ease-elastic/);
    expect(css).not.toMatch(/\.pop-in \{ animation: pop-in[^}]*--ease-elastic/);
  });

  test("the reveal engine masks, clears every inline style, and stays simple on weak devices", () => {
    for (const fx of ["rise", "depth", "wipe", "stagger", "cards", "tiles", "rows", "footer"]) expect(reveal).toContain(`"${fx}"`);
    expect(reveal).toContain("clipPath");
    expect(reveal).toMatch(/const CLEAR = "[^"]*clipPath[^"]*"/);
    expect(reveal).toContain("prefers-reduced-motion: reduce");
    expect(reveal).toContain("saveData");
    // Only the ease values matter (prose may say "bounce"): none of them springs past its target.
    expect(reveal).not.toMatch(/ease: "[^"]*(elastic|back|bounce)/);
  });

  test("an entrance killed midway never leaves content hidden or masked", () => {
    const body = reveal.slice(reveal.indexOf("function reveal("), reveal.indexOf("function bento("));
    const tweens = body.match(/gsap\.(to|fromTo)\(list,/g) ?? [];
    expect(tweens.length).toBeGreaterThanOrEqual(4);
    expect((body.match(/onInterrupt: clear/g) ?? []).length).toBe(tweens.length);
    // Unmount stops and clears exactly what that block's entrance touched, siblings included (demo cards).
    const cleanup = reveal.slice(reveal.indexOf("export function registerReveal"), reveal.indexOf("export function pageStagger"));
    expect(cleanup).toContain("owned.get(el)");
    expect(cleanup).toMatch(/gsap\.set\(mine, \{ clearProps: CLEAR \}\)/);
    // Below-fold studio blocks: no CSS transition fights the hide, and a failsafe shows anything stuck.
    expect(reveal).toContain('gsap.set(later, { transition: "none", opacity: 0, y: 12 })');
    expect(reveal).toContain("clearTimeout(fallback)");
  });

  test("the studio sidebar keeps a native, slim, neutral scrollbar", () => {
    expect(readFileSync("components/shell/Nav.tsx", "utf8")).toContain("nav-scroll");
    expect(css).toMatch(/\.nav-scroll \{[^}]*scrollbar-width: thin/);
    expect(css).not.toMatch(/\.nav-scroll[^{]*\{[^}]*scrollbar-width: none/);
    // Legacy webkit styling only where the standard props are missing, so it never overrides them.
    expect(css).toMatch(/@supports not \(scrollbar-width: thin\) \{\s*\.nav-scroll::-webkit-scrollbar/);
  });

  test("the studio slides between routes without the full-screen wave", () => {
    expect(readFileSync("app/(studio)/template.tsx", "utf8")).toContain('variant="app"');
    expect(readFileSync("components/shared/PageTransition.tsx", "utf8")).toContain('variant === "site"');
  });
});
