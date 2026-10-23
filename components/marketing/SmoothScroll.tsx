"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type Lenis from "lenis";

let lenis: Lenis | null = null;
let popped = false; // back/forward: let the browser restore the old position

/** The running Lenis instance, or null (reduced motion, touch, not loaded yet). PageScrollbar drags through it. */
export const getLenis = () => lenis;

const waiting = new Set<(l: Lenis) => void>();
/** Run `cb` with the Lenis instance as soon as it exists (now, or once the lazy import lands). Returns a cancel. */
export function whenLenis(cb: (l: Lenis) => void): () => void {
  if (lenis) {
    cb(lenis);
    return () => {};
  }
  waiting.add(cb);
  return () => waiting.delete(cb);
}

/**
 * Inertial "liquid" scroll for every page: landing, studio and admin (mounted once in the root layout).
 * Loaded after hydration so it never delays first paint, skipped for reduced motion and touch devices
 * (their native scroll is already fluid). In-page anchor links glide to their section.
 * Panels that scroll on their own (sidebars, chat, dialogs, tables) keep native scroll: they are
 * marked data-lenis-prevent, and allowNestedScroll covers any we missed. While a dialog locks the
 * page (Radix sets data-scroll-locked on body) Lenis pauses so the page behind cannot drift.
 */
export function SmoothScroll() {
  const path = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let stop = () => {};
    let cancelled = false;
    import("lenis").then(({ default: L }) => {
      if (cancelled) return;
      const l = new L({ lerp: 0.075, wheelMultiplier: 0.8, anchors: true, autoRaf: true, allowNestedScroll: true });
      lenis = l;
      waiting.forEach((cb) => cb(l));
      waiting.clear();
      document.documentElement.classList.add("lenis");
      const body = document.body;
      const sync = () => (body.hasAttribute("data-scroll-locked") ? l.stop() : l.start());
      const onPop = () => (popped = true);
      window.addEventListener("popstate", onPop);
      const mo = new MutationObserver(sync);
      mo.observe(body, { attributes: true, attributeFilter: ["data-scroll-locked"] });
      stop = () => {
        mo.disconnect();
        window.removeEventListener("popstate", onPop);
        l.destroy();
        lenis = null;
        document.documentElement.classList.remove("lenis");
      };
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  // A new page starts at the top (or its #anchor) instead of finishing the previous page's glide.
  useEffect(() => {
    if (popped) return void (popped = false);
    if (!lenis || location.hash) return;
    lenis.scrollTo(0, { immediate: true, force: true });
  }, [path]);

  return null;
}
