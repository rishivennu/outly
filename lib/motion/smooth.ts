/**
 * 1181: the page's smooth-scroll engine, whichever one runs. Public pages use GSAP ScrollSmoother
 * (components/marketing/Smoother.tsx); everything else uses Lenis (components/marketing/SmoothScroll.tsx). Both glide
 * on the same curve (SMOOTH in lib/motion/tokens.ts). Code that scrolls the page (the page scrollbar, anchor holds)
 * goes through scrollPageTo, so it never has to know which engine is live.
 *
 * No GSAP or Lenis import here: the studio's first load reaches this file (tests/perf-js.test.ts).
 */
export type SmoothEngine = {
  kind: "smoother" | "lenis";
  /** Scroll the page to y; `now` jumps there with no glide. */
  to: (y: number, now?: boolean) => void;
};

let engine: SmoothEngine | null = null;
let claims = 0;
const subs = new Set<() => void>();
const waiting = new Set<() => void>();
/** The page's scroller is settled: ScrollSmoother is running, or nothing claimed the page (Lenis or native). */
const settled = () => claims === 0 || engine?.kind === "smoother";
function flush() {
  if (!settled()) return;
  const now = Array.from(waiting);
  waiting.clear();
  now.forEach((f) => f());
}

/** The live engine, or null (touch, reduced motion, not loaded yet). */
export const smoothEngine = () => engine;
export function setSmoothEngine(e: SmoothEngine | null) {
  engine = e;
  flush();
}
/** Drop the engine only if it is still `kind` (a newer engine may already have taken over). */
export function clearSmoothEngine(kind: SmoothEngine["kind"]) {
  if (engine?.kind === kind) engine = null;
}

/** ScrollSmoother takes the page: Lenis stands down while a claim is held. Returns the release. */
export function claimSmooth(): () => void {
  claims++;
  subs.forEach((f) => f());
  let done = false;
  return () => {
    if (done) return;
    done = true;
    claims--;
    subs.forEach((f) => f());
    flush();
  };
}
export const smoothClaimed = () => claims > 0;
export function onSmoothClaim(cb: () => void): () => void {
  subs.add(cb);
  return () => void subs.delete(cb);
}

/**
 * Run cb once the page's scroller is settled: right away, or as soon as a pending ScrollSmoother is created (or fails
 * and lets go). ScrollTriggers that pin (the landing panels) must be made after ScrollSmoother, never before it.
 * Returns a cancel.
 */
export function whenScrollReady(cb: () => void): () => void {
  if (settled()) {
    cb();
    return () => {};
  }
  waiting.add(cb);
  return () => void waiting.delete(cb);
}

/** Scroll the page to y through the live engine, or natively when none runs. */
export function scrollPageTo(y: number, now = false) {
  if (engine) return engine.to(y, now);
  window.scrollTo({ top: y, behavior: now ? ("instant" as ScrollBehavior) : "smooth" });
}
