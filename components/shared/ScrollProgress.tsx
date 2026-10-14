"use client";
import { useEffect, useRef } from "react";

/**
 * Lime reading-progress line pinned to the top of every page. Browsers with scroll-driven
 * animations run it in CSS (off the main thread, see .scroll-prog in globals.css); the rest
 * get a rAF-throttled scroll listener that writes the same --p value. Hidden when a page
 * does not scroll, and decorative only (aria-hidden).
 */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || (typeof CSS !== "undefined" && CSS.supports("animation-timeline: scroll()"))) return;
    el.dataset.js = "";
    let raf = 0;
    const tick = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      el.style.setProperty("--p", String(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0));
      el.dataset.on = max > 8 ? "1" : "0";
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    const ro = new ResizeObserver(on);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      ro.disconnect();
    };
  }, []);
  return <div ref={ref} aria-hidden="true" className="scroll-prog" />;
}
