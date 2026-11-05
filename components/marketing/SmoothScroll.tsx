"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type Lenis from "lenis";

let lenis: Lenis | null = null;
let popped = false; // back/forward: let the browser restore the old position

/** The running Lenis instance, or null (reduced motion, touch, not loaded yet). PageScrollbar drags through it. */
export const getLenis = () => lenis;

const waiting = new Set<(l: Lenis) => void>();

const LET_GO = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
/**
 * 1137: arriving on /#section from another page, the browser jumps to the section once, then the sections above it
 * finish laying out (the scroll scenes add their pin spacing) and push it a screen or more down. Keep it in place
 * while the page settles (up to 2.5 s), and let go the moment the visitor scrolls or taps themselves.
 */
function holdAnchor(id: string) {
  let el: HTMLElement | null = null;
  try {
    el = document.getElementById(decodeURIComponent(id));
  } catch {
    return;
  }
  if (!el || typeof ResizeObserver === "undefined") return;
  const target = el;
  let done = false;
  const align = () => {
    if (done) return;
    const off = target.getBoundingClientRect().top - (parseFloat(getComputedStyle(target).scrollMarginTop) || 0);
    if (Math.abs(off) < 2) return;
    const y = window.scrollY + off;
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
    else window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
  };
  const ro = new ResizeObserver(align);
  const quit = () => {
    done = true;
    ro.disconnect();
    window.clearTimeout(timer);
    for (const e of LET_GO) window.removeEventListener(e, quit);
  };
  const timer = window.setTimeout(quit, 2500);
  for (const e of LET_GO) window.addEventListener(e, quit, { passive: true });
  ro.observe(document.body);
  requestAnimationFrame(align);
  return quit;
}
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
    if (location.hash) return holdAnchor(location.hash.slice(1));
    if (!lenis) return;
    lenis.scrollTo(0, { immediate: true, force: true });
  }, [path]);

  return null;
}
