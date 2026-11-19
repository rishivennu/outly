"use client";

import { useEffect, useState } from "react";

/**
 * R1216: the phone top bar follows the scroll. Moving down the page (content going up under the finger) folds the
 * bar away so the page gets its 52px back; moving back toward the top brings it in; at the top it is always there.
 * One listener for the whole app, in the shared bar, not one per page:
 * - document-level capture, so a page that scrolls inside its own container (not the window) is seen too. Each
 *   scroller is tracked on its own; a horizontal scroller (platform tabs, chips) has no vertical delta and is ignored,
 *   as is anything inside a dialog or sheet, and any box shorter than half the screen (menus, lists in cards).
 * - THRESHOLD px of travel in one direction before the bar moves, so a resting finger or a rubber band never flickers.
 * - never hidden while the page is within SHOW_UNTIL px of its top, while a field has focus (the keyboard moves the
 *   page), or while something in the bar is open (the bell's list); a route change puts it back.
 * Returns `lifted` (content has scrolled under the bar: frost it) and `hidden` (fold it away).
 */
export const THRESHOLD = 12;
export const SHOW_UNTIL = 64;
const IGNORE = '[role="dialog"], [aria-modal="true"], [data-header-scroll="ignore"]';

export type HeaderScroll = { lifted: boolean; hidden: boolean };

export function useHeaderScroll(resetKey: string, bar: React.RefObject<HTMLElement | null>): HeaderScroll {
  const [s, setS] = useState<HeaderScroll>({ lifted: false, hidden: false });
  useEffect(() => {
    setS((p) => (p.hidden ? { ...p, hidden: false } : p));
  }, [resetKey]);
  useEffect(() => {
    const last = new WeakMap<Element, number>();
    let acc = 0; // signed travel since the bar last moved: + down the page, - back up
    let raf = 0;
    let pending: Element | null = null;
    const root = () => document.scrollingElement ?? document.documentElement;
    const read = () => {
      raf = 0;
      const el = pending;
      pending = null;
      if (!el) return;
      const top = el.scrollTop;
      const prev = last.get(el);
      last.set(el, top);
      // content has moved under the bar (the window or the page's own scroller): frost it
      const lifted = top > 2;
      if (prev === undefined) {
        setS((p) => (p.lifted === lifted ? p : { ...p, lifted }));
        return;
      }
      const delta = top - prev;
      if (delta === 0) return;
      acc = Math.sign(acc) === Math.sign(delta) ? acc + delta : delta;
      const active = document.activeElement as HTMLElement | null;
      const typing = !!active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
      const open = !!bar.current?.querySelector('[aria-expanded="true"]');
      let hidden: boolean | null = null;
      if (top <= SHOW_UNTIL || typing || open) hidden = false;
      else if (acc > THRESHOLD) hidden = true;
      else if (acc < -THRESHOLD) hidden = false;
      if (hidden !== null && Math.abs(acc) > THRESHOLD) acc = 0;
      setS((p) => (p.lifted === lifted && (hidden === null || p.hidden === hidden) ? p : { lifted, hidden: hidden ?? p.hidden }));
    };
    const onScroll = (e: Event) => {
      const t = e.target;
      let el: Element | null = null;
      if (t === document || t === window) el = root();
      else if (t instanceof Element) {
        // only a page-sized vertical scroller counts, never a list in a card, a menu, a dialog or a horizontal strip
        if (t.clientHeight < innerHeight * 0.5 || t.scrollHeight <= t.clientHeight || t.closest(IGNORE)) return;
        el = t;
      }
      if (!el) return;
      pending = el;
      if (!raf) raf = requestAnimationFrame(read);
    };
    // keyboard users tabbing into a folded bar get it back
    const onFocus = () => setS((p) => (p.hidden ? { ...p, hidden: false } : p));
    pending = root();
    read();
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    const b = bar.current;
    b?.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      b?.removeEventListener("focusin", onFocus);
      cancelAnimationFrame(raf);
    };
  }, [bar]);
  return s;
}
