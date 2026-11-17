import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EASE, GSAP_EASE, overshoots } from "@/lib/motion/tokens";

// Round 1188 (user, 11-17): "do both Flip and SplitText". Lists rearrange instead of redrawing (GSAP Flip), and
// page headlines arrive line by line out of their own masks (GSAP SplitText). Both load on demand, both stop at
// reduced motion, and neither ever shares a property with framer-motion on the same element.
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("Flip: lists rearrange (1188)", () => {
  const flip = read("lib/motion/flip.ts");

  test("GSAP and the plugin are loaded on demand, never with the first page", () => {
    expect(flip).toContain('import("gsap/Flip")');
    expect(flip).toContain("loadGsap()");
    expect(flip).toContain("registerPlugin(m.Flip)");
    // A failed load is not an error: the list simply does not glide.
    expect(flip).toContain("loading = null;");
    expect(flip).not.toContain('from "gsap"');
  });

  test("it glides on the smooth in-out curve and nothing overshoots", () => {
    expect(flip).toContain("ease: GSAP_EASE.smooth");
    expect(GSAP_EASE.smooth).toBe("power2.inOut");
    expect(overshoots(EASE.smooth)).toBe(false);
    for (const banned of ["back.", "elastic.", "bounce.", "bounce:"]) expect(flip).not.toContain(banned);
  });

  test("reduced motion and weak devices get no Flip at all", () => {
    expect(flip).toContain("reduced()");
    expect(flip).toContain("simple()");
    // Only transform and opacity are written, and they are cleared again.
    expect(flip).toContain('const CLEAR = "opacity,transform,transition"');
    expect(flip).toContain("clearProps: CLEAR");
  });

  test("a row is matched by its own id, and long lists are left alone", () => {
    expect(flip).toContain('export const FLIP_ATTR = "data-flip-id"');
    expect(flip).toMatch(/MAX_ROWS\s*=\s*\d+/);
    expect(flip).toContain("prune: true");
  });

  test("admin tables hand every row its key as its flip id", () => {
    const ui = read("components/admin/ui.tsx");
    expect(ui).toContain('"data-flip-id": row.key ?? undefined');
    expect(read("app/admin/(panel)/tickets/page.tsx")).toContain("data-flip-id={t.id}");
  });

  test("DataSwap measures the old rows while they are still on the page, and falls back to the fade", () => {
    const ds = read("components/shared/DataSwap.tsx");
    expect(ds).toContain("snap.current = flipCapture(ref.current)");
    expect(ds).toContain("flipPlay(ref.current, first) : settleRegion(ref.current)");
    expect(ds).toContain("useIso(");
    expect(ds).toContain("loadFlip()");
  });

  test("the content library never lets both engines touch one property", () => {
    const cl = read("components/content/ContentLibrary.tsx");
    expect(cl).toContain("data-flip-id={p.id}");
    expect(cl).toContain("flipPlay(grid.current, from, { enter: false })");
    // framer keeps the arrival fade (opacity only); GSAP owns every transform in the grid.
    expect(cl).toContain("initial={{ opacity: 0 }}");
    expect(cl).not.toContain("<AnimatePresence>");
    expect(cl).not.toMatch(/<motion\.li[^>]*\blayout\b/);
    expect(cl).not.toMatch(/<motion\.(ul|li)[^>]*\by:/);
  });
});

describe("SplitText: headlines arrive line by line (1188)", () => {
  const split = read("lib/motion/split.ts");
  const css = read("app/globals.css");

  test("GSAP and the plugin are loaded on demand", () => {
    expect(split).toContain('import("gsap/SplitText")');
    expect(split).toContain("registerPlugin(m.SplitText)");
    expect(split).not.toContain('from "gsap"');
  });

  test("lines are masked, re-split on resize, and read as one heading", () => {
    expect(split).toContain('type: "lines"');
    expect(split).toContain('mask: "lines"');
    expect(split).toContain("autoSplit: true");
    expect(split).toContain('aria: "auto"');
    expect(split).toContain("onSplit:");
    expect(split).toContain("split?.revert()");
  });

  test("it plays once, on its own clock, never scrubbed by the scrollbar", () => {
    expect(split).toContain("IntersectionObserver");
    expect(split).toContain("io?.disconnect()");
    expect(split).not.toContain("ScrollTrigger");
    expect(split).not.toContain("scrub");
  });

  test("the curve is the smooth in-out one and nothing overshoots", () => {
    expect(split).toContain("ease: GSAP_EASE.smooth");
    for (const banned of ["back.", "elastic.", "bounce.", "bounce:"]) expect(split).not.toContain(banned);
  });

  test("reduced motion shows the headline, weak devices get one fade", () => {
    expect(split).toContain("if (reduced()) {");
    expect(split).toContain("simple()");
    expect(css).toContain("html.js [data-split-lines]:not([data-split-done]) { opacity: 1; animation: none; }");
  });

  test("the waiting state is .01, so the headline still records the LCP paint", () => {
    expect(css).toContain("html.js [data-split-lines]:not([data-split-done]) { opacity: .01;");
    expect(css).not.toContain("[data-split-lines]:not([data-split-done]) { opacity: 0;");
    // Without JS nothing is hidden at all, and a failsafe shows the headline even if the plugin never lands.
    expect(css).toContain("@keyframes sl-failsafe");
    expect(css).toMatch(/animation: sl-failsafe 0s linear 2s forwards/);
    expect(css).toContain(".sl-line-mask");
  });

  test("every page headline that uses it keeps its text in the HTML", () => {
    for (const [file, needle] of [
      ["components/marketing/bits.tsx", "<SplitLines className=\"display text-balance"],
      ["app/(marketing)/blog/page.tsx", "<SplitLines className=\"display mt-6 max-w-[14ch]"],
      ["app/(marketing)/blog/category/[category]/page.tsx", "{cat.name}</SplitLines>"],
      ["components/blog/BlogArticle.tsx", "{title}</SplitLines>"],
    ] as const) {
      const src = read(file);
      expect(src).toContain(needle);
      expect(src).toContain('from "@/components/shared/SplitLines"');
    }
    const comp = read("components/shared/SplitLines.tsx");
    expect(comp).toContain('data-split-lines=""');
    expect(comp).toContain("splitLinesIn(ref.current)");
  });
});
