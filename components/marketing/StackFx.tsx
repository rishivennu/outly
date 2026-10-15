"use client";
import { useEffect } from "react";

/**
 * Mobile card stack: every card in the list is sticky (globals.css), so the next card slides up and
 * fully covers the one before. This only feeds each card a --cover value from 0 to 1 (how far the
 * next card has come over it) so CSS can shrink and dim it. One rAF per scroll frame, mobile only,
 * and nothing at all under reduced motion.
 */
export function StackFx({ id }: { id: string }) {
  useEffect(() => {
    const list = document.getElementById(id);
    if (!list) return;
    const small = window.matchMedia("(max-width: 767px)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const items = Array.from(list.children) as HTMLElement[];
    let raf = 0;

    const tick = () => {
      raf = 0;
      if (!small.matches || still.matches) {
        for (const el of items) el.style.removeProperty("--cover");
        return;
      }
      for (let i = 0; i < items.length; i++) {
        const next = items[i + 1];
        let c = 0;
        if (next) {
          const a = items[i].getBoundingClientRect();
          const b = next.getBoundingClientRect();
          c = 1 - (b.top - a.top) / Math.max(1, a.height);
          c = Math.min(1, Math.max(0, c));
        }
        items[i].style.setProperty("--cover", c.toFixed(3));
      }
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    tick();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    small.addEventListener("change", queue);
    still.addEventListener("change", queue);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      small.removeEventListener("change", queue);
      still.removeEventListener("change", queue);
    };
  }, [id]);
  return null;
}
