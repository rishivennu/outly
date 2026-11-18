import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/*
 * Round 1183 (user, 11-17): the GSAP horizontal scrolling gallery on What you get and Try it, on phones too, plus the
 * pinned-panel stack on phones. These pin the wiring that is easy to break: no nested pins, the reduced-motion row,
 * keyboard focus, the phone keyboard, and the cards themselves.
 */
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const hs = read("lib/motion/hscroll.ts");
const scenes = read("components/marketing/ScrollScenes.tsx");
const panels = read("lib/motion/panels.ts");
const row = read("components/marketing/HScroll.tsx");
const features = read("components/marketing/Features.tsx");
const stage = read("components/marketing/TryItStage.tsx");
const css = read("app/globals.css");
const smoother = read("components/marketing/Smoother.tsx");

describe("horizontal galleries (1183)", () => {
  test("What you get puts every feature card, lead first, in one gallery", () => {
    expect(features).toContain("<HScroll");
    expect(features).toContain('className="hs-item feat-lead"');
    expect(features).toContain("rest.map((f) => (");
    expect(features).not.toContain("lg:grid-cols-3");
    expect(features).toContain('eyebrow="What you get"');
  });

  test("Try it lays every card in one gallery: your idea, three ideas, three drafts, keep them", () => {
    expect(stage).toContain("<HScroll");
    for (const c of ["try-item-in", "try-item-idea", "try-item-out", "try-item-keep"]) expect(stage).toContain(c);
    expect(stage).toContain("ORDER.map((k) => (");
    expect(stage).not.toContain("try-tabs"); // every draft has its own card now
  });

  test("the gallery rides its sheet's hold instead of pinning inside a pinned sheet", () => {
    expect(scenes).toContain("hscroll(el)");
    expect(scenes).toContain("holds.set(sheet, { screens: k, onHold: g.drive, bind: g.bind })");
    expect(scenes).toContain("ownPins.push(g.pin)");
    // the fallback pins come after the stack, so refresh runs in page order
    expect(scenes.indexOf("undo.push(stackPanels(panels, holds))")).toBeLessThan(scenes.indexOf("ownPins.forEach((pin) => pin())"));
    expect(scenes.indexOf("hscroll(el)")).toBeLessThan(scenes.indexOf("undo.push(stackPanels(panels, holds))"));
    expect(panels).toContain("hold?.bind?.(");
  });

  test("one pixel across per pixel down, last card's right edge ends at the box edge", () => {
    expect(hs).toContain("dist = Math.max(0, track.scrollWidth - box.clientWidth)");
    expect(hs).toContain("return dist / innerHeight");
  });

  test("cards grow into place as they arrive, moved on their wrapper only", () => {
    expect(hs).toContain('gsap.quickSetter(el, "scale")');
    expect(scenes).toContain("[data-hscroll],.hs-item");
  });

  test("keyboard focus brings an off-screen card into view; typing on a phone never moves the track", () => {
    expect(hs).toContain('root.addEventListener("focusin", onFocusIn)');
    expect(hs).toContain('t.matches(":focus-visible")');
    expect(hs).toContain("scrollPageTo(");
    expect(hs).toContain('t.matches("input, textarea")');
    expect(stage).toContain('new CustomEvent("hs:show", { bubbles: true })');
  });

  test("later content re-measures", () => {
    expect(hs).toContain("new ResizeObserver(");
    expect(hs).toContain('ScrollTrigger.addEventListener("refresh", onRefresh)');
  });

  test("reduced motion and no JS: a native sideways row with snap points and a hint", () => {
    expect(row).toContain("data-hscroll");
    expect(row).not.toMatch(/aria-hidden="true">\s*\{children\}/);
    expect(css).toContain(".hs-box { overflow-x: auto;");
    expect(css).toContain("scroll-snap-type: x mandatory");
    expect(css).toContain("[data-hs-on] .hs-box { overflow: visible; scroll-snap-type: none; }");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.hs-hint \{ display: block;/);
    expect(css).toContain("#features { overflow-x: clip; }");
    expect(css).toContain("#try { overflow-x: clip; }");
    expect(css).toContain("#pricing { overflow-x: clip; }");
  });

  test("R1196: Pricing is a gallery too, as a list; its cards rise the old way only when every plan fits", () => {
    const cards = read("components/marketing/PricingCards.tsx");
    expect(cards).toContain('<HScroll label="Plans" focusable list');
    expect(row).toContain('const Track = list ? "ul" : "div"');
    expect(scenes).toContain("still.push(el)");
    expect(scenes).toContain("still.some((g) => pri.contains(g))");
    expect(css.indexOf(".price-item {")).toBeLessThan(css.indexOf("1120: creator profile card"));
  });

  test("the CSS lives above the studio markers", () => {
    const at = css.indexOf(".hs-box { overflow-x: auto;");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(css.indexOf("1120: creator profile card"));
  });

  test("phones keep native momentum scroll: ScrollSmoother still stays off on touch", () => {
    expect(smoother).toContain('window.matchMedia("(pointer: coarse)").matches');
    expect(smoother).toContain("smoothTouch: false");
  });
});
