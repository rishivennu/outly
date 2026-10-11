"use client";
import { useEffect } from "react";

/**
 * Inertial page scroll for the public pages. Loaded after hydration so it never delays first paint,
 * skipped for reduced motion and for touch devices (their native scroll is already fluid).
 * In-page anchor links glide to their section, offset for the floating nav.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let stop = () => {};
    let cancelled = false;
    import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, anchors: true, autoRaf: true });
      document.documentElement.classList.add("lenis");
      stop = () => {
        lenis.destroy();
        document.documentElement.classList.remove("lenis");
      };
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return null;
}
