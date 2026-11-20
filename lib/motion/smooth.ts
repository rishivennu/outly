/**
 * The page's smooth-scroll engine: Lenis (components/marketing/SmoothScroll.tsx), on every page, or none (touch,
 * reduced motion, not loaded yet), when the page scrolls natively. R1262: the only engine; GSAP ScrollSmoother is gone.
 * Code that scrolls the page (the page scrollbar, anchor holds, the galleries) goes through scrollPageTo, so it never
 * fights the engine's own glide.
 *
 * No GSAP or Lenis import here: the studio's first load reaches this file (tests/perf-js.test.ts).
 */
export type SmoothEngine = {
  kind: "lenis";
  /** Scroll the page to y; `now` jumps there with no glide. */
  to: (y: number, now?: boolean) => void;
};

let engine: SmoothEngine | null = null;

/** The live engine, or null (touch, reduced motion, not loaded yet). */
export const smoothEngine = () => engine;
export function setSmoothEngine(e: SmoothEngine | null) {
  engine = e;
}
/** Drop the engine only if it is still `kind` (a newer engine may already have taken over). */
export function clearSmoothEngine(kind: SmoothEngine["kind"]) {
  if (engine?.kind === kind) engine = null;
}

/** Scroll the page to y through the live engine, or natively when none runs. */
export function scrollPageTo(y: number, now = false) {
  if (engine) return engine.to(y, now);
  window.scrollTo({ top: y, behavior: now ? ("instant" as ScrollBehavior) : "smooth" });
}
