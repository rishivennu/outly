"use client";
import { useEffect, useRef, type RefObject } from "react";

/**
 * 1154: a row that scrolls sideways on a phone (range options, platform tabs). It fades only the edge that has
 * more behind it (data-fade="start|end|both", styled by .edge-fade in globals.css), so a row that fits is never
 * dimmed, and it keeps the picked option in view whenever `active` changes.
 */
export function useEdgeFade<T extends HTMLElement>(active: unknown, shared?: RefObject<T | null>) {
  const own = useRef<T>(null);
  // A row that already has a ref (the sliding indicator's box) shares it instead of needing two.
  const ref = shared ?? own;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mark = () => {
      const max = el.scrollWidth - el.clientWidth;
      const l = el.scrollLeft > 2;
      const r = max > 2 && el.scrollLeft < max - 2;
      const v = l && r ? "both" : l ? "start" : r ? "end" : "";
      if (v) el.dataset.fade = v;
      else delete el.dataset.fade;
    };
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mark);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", mark);
      ro?.disconnect();
    };
  }, [ref]);
  useEffect(() => {
    const el = ref.current;
    const on = el?.querySelector<HTMLElement>('[aria-checked="true"],[aria-selected="true"],[aria-current="page"]');
    if (!el || !on || el.scrollWidth <= el.clientWidth) return;
    // Scroll only the row, never the page: scrollIntoView would also move the window on iOS.
    const want = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: Math.max(0, want), behavior: reduce ? "auto" : "smooth" });
  }, [active, ref]);
  return ref;
}
