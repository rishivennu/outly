"use client";
/**
 * The analytics dashboard's motion (1080), after the Arix brief: ONE requestAnimationFrame loop per root that
 * writes transform and opacity straight to element.style (no React state per frame), staggered as
 * easeOut(clamp01((t - 0.1 - i * 0.045) / 0.7)). Reduced motion keeps the timing but only cross-fades.
 * Time-based: it plays at a fixed pace once the root is on screen, never scrubbed to scroll.
 */
import { useCallback, useEffect, useRef } from "react";

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeOut = (x: number) => 1 - (1 - x) ** 3;
export const prefersReduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Progress of the i-th staggered element at time t (seconds since start). */
export const stagger = (t: number, i: number) => easeOut(clamp01((t - 0.1 - i * 0.045) / 0.7));

/**
 * Plays every [data-enter] inside the root, in DOM order, when the root first scrolls into view.
 * Returns `replay()`. Inline styles are cleared at the end so nothing keeps a stacking context.
 */
export function useEnter<T extends HTMLElement>() {
  const root = useRef<T>(null);
  const raf = useRef(0);

  const play = useCallback(() => {
    const el = root.current;
    if (!el) return;
    cancelAnimationFrame(raf.current);
    const items = [...el.querySelectorAll<HTMLElement>("[data-enter]")];
    const reduced = prefersReduced();
    for (const it of items) {
      it.style.animation = "none"; // the CSS fallback reveal (globals.css) stands down once JS runs
      it.style.opacity = "0";
      if (!reduced) it.style.transform = "translate3d(0,14px,0)";
    }
    el.dispatchEvent(new CustomEvent("pulse:enter"));
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      let done = true;
      items.forEach((it, i) => {
        const p = stagger(t, i);
        if (p < 1) done = false;
        it.style.opacity = String(p);
        if (!reduced) it.style.transform = p < 1 ? `translate3d(0,${(1 - p) * 14}px,0)` : "";
      });
      if (!done) raf.current = requestAnimationFrame(tick);
      else for (const it of items) { it.style.opacity = ""; it.style.transform = ""; }
    };
    raf.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.setAttribute("data-enter-js", "");
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect();
          play();
        }
      },
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, [play]);

  return { root, replay: play };
}

/**
 * A 0..1 progress driven by its own rAF, for one-off draws (sparklines, bars). Calls `write(p)` every frame;
 * reduced motion jumps straight to 1. `delay` in seconds.
 */
export function drawIn(write: (p: number) => void, { duration = 0.9, delay = 0 } = {}): () => void {
  if (prefersReduced()) {
    write(1);
    return () => {};
  }
  let id = 0;
  const t0 = performance.now() + delay * 1000;
  const tick = (now: number) => {
    const p = easeOut(clamp01((now - t0) / (duration * 1000)));
    write(p);
    if (p < 1) id = requestAnimationFrame(tick);
  };
  write(0);
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}
