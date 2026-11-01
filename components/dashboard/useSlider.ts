"use client";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * One sliding indicator for tabs, segmented controls and filter chips (1080, shared since 1081). The selected
 * element is measured and the indicator moved with a CSS transform; the CSS owns the transition, so reduced
 * motion just snaps. The very first placement never slides in from the left edge.
 */
export function useSlider<T extends HTMLElement>(dep: unknown, { selector = '[aria-selected="true"],[aria-checked="true"]', block = false } = {}) {
  const box = useRef<T>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const place = useCallback(() => {
    const b = box.current;
    const el = b?.querySelector<HTMLElement>(selector);
    const s = bar.current;
    if (!b || !s) return;
    if (!el) {
      s.style.opacity = "0";
      return;
    }
    const first = !placed.current;
    if (first) s.style.transition = "none";
    s.style.width = `${el.offsetWidth}px`;
    // block: the indicator is a full plate that also follows wrapped rows (filter chips); otherwise it only
    // moves sideways and the CSS sets its height (an underline, a segment pill).
    if (block) s.style.height = `${el.offsetHeight}px`;
    s.style.transform = `translate3d(${el.offsetLeft}px,${block ? el.offsetTop : 0}px,0)`;
    s.style.opacity = "1";
    if (first) {
      void s.offsetWidth; // commit the snapped position before the transition comes back
      s.style.transition = "";
      placed.current = true;
    }
  }, [selector, block]);
  useLayoutEffect(place, [dep, place]);
  useEffect(() => {
    const ro = new ResizeObserver(place);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [place]);
  return { box, bar };
}
