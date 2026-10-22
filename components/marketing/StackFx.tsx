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
    let live = false;
    const last: string[] = [];

    const tick = () => {
      raf = 0;
      if (!small.matches || still.matches) {
        if (live) for (const el of items) el.style.removeProperty("--cover");
        live = false;
        last.length = 0;
        return;
      }
      live = true;
      // All reads first, then all writes: interleaving them would force a layout for every card.
      const boxes = items.map((el) => el.getBoundingClientRect());
      for (let i = 0; i < items.length; i++) {
        const a = boxes[i], b = boxes[i + 1];
        const c = b ? Math.min(1, Math.max(0, 1 - (b.top - a.top) / Math.max(1, a.height))) : 0;
        const v = c.toFixed(3);
        if (last[i] !== v) items[i].style.setProperty("--cover", (last[i] = v));
      }
    };
    const queue = () => {
      if (!small.matches && !live) return; // desktop: nothing to do on scroll
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const change = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    tick();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    small.addEventListener("change", change);
    still.addEventListener("change", change);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      small.removeEventListener("change", change);
      still.removeEventListener("change", change);
    };
  }, [id]);
  return null;
}
