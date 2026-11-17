"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { ScrollSmoother as SmootherT } from "gsap/ScrollSmoother";
import type { ScrollTrigger as TriggerT } from "gsap/ScrollTrigger";
import { SMOOTH } from "@/lib/motion/tokens";
import { claimSmooth, clearSmoothEngine, setSmoothEngine } from "@/lib/motion/smooth";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;
let live: SmootherT | null = null;
/** The running ScrollSmoother, or null (touch, reduced motion, not loaded yet, or not a public page). */
export const getSmoother = () => live;

let ST: typeof TriggerT | null = null;
let pins: TriggerT[] = [];
/**
 * position: sticky never sticks inside the smoothed content (its scroll box, the wrapper, never scrolls: the content
 * moves by transform). Each sticky bar on the page (the Comparison header) is pinned by ScrollTrigger instead, between
 * the same edges sticky would use: from its own top offset until its parent's bottom pushes it off.
 */
function pinSticky(root: HTMLElement) {
  pins.forEach((p) => p.kill());
  pins = [];
  if (!ST) return;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(".sticky"))) {
    const box = el.parentElement;
    if (!box || getComputedStyle(el).position !== "sticky") continue;
    const top = () => parseFloat(getComputedStyle(el).top) || 0;
    pins.push(
      ST.create({
        trigger: el,
        pin: true,
        pinSpacing: false,
        start: () => `top ${top()}px`,
        endTrigger: box,
        end: () => `bottom ${top() + el.offsetHeight}px`,
        invalidateOnRefresh: true,
      }),
    );
  }
}

/**
 * 1181: GSAP ScrollSmoother for every public page (user, 11-17: the ScrollSmoother feel "for the entire web app").
 * The content glides after the native scroll on SMOOTH (1 s, expo.out); the studio's Lenis uses the same curve, so
 * landing, blog, pricing and the app all scroll alike. Scroll position, keyboard scrolling, find-in-page and the
 * scrollbar stay native: only the painted content lags behind and catches up.
 *
 * Wraps main and the footer only. ScrollSmoother moves #smooth-content with a transform, so anything that must stay
 * on screen (the nav, the sky, cursor and text effects, the page wave, dialogs) lives outside it, and nothing inside
 * relies on position: sticky (Comparison pins its header with ScrollTrigger instead while this runs).
 * Touch screens and reduced motion get plain native scroll: the wrapper divs are then ordinary blocks.
 * In-page anchors (/#pricing on the landing page) glide to their section and keep its scroll-margin.
 */
export function Smoother({ children }: { children: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const path = usePathname();

  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const release = claimSmooth(); // now, before the import lands, so Lenis never starts underneath
    let dead = false;
    let s: SmootherT | null = null;
    let ro: ResizeObserver | null = null;
    Promise.all([import("gsap"), import("gsap/ScrollTrigger"), import("gsap/ScrollSmoother")])
      .then(([{ gsap }, { ScrollTrigger }, { ScrollSmoother }]) => {
        if (dead || !wrap.current || !content.current) return;
        gsap.registerPlugin(ScrollTrigger, ScrollSmoother);
        // The wrapper becomes position: fixed at the top of the screen, so the sticky nav no longer pushes the page
        // down: the content keeps that room as padding (--smooth-top), set in the same frame so nothing jumps.
        const html = document.documentElement;
        const head = document.querySelector<HTMLElement>(".mnav");
        const room = () => html.style.setProperty("--smooth-top", `${head?.offsetHeight ?? 0}px`);
        room();
        html.classList.add("smoother");
        if (head) (ro = new ResizeObserver(room)).observe(head);
        s = ScrollSmoother.create({
          wrapper: wrap.current,
          content: content.current,
          smooth: SMOOTH.duration,
          ease: SMOOTH.gsap,
          effects: true, // data-speed / data-lag layers
          smoothTouch: false,
        });
        live = s;
        ST = ScrollTrigger;
        const smoother = s;
        setSmoothEngine({ kind: "smoother", to: (y, now) => smoother.scrollTo(y, !now) });
        pinSticky(content.current);
      })
      .catch(() => {
        ro?.disconnect();
        document.documentElement.classList.remove("smoother");
        if (!dead) release(); // no ScrollSmoother: let Lenis have the page
      });

    // Same-page anchor links: glide there instead of letting the browser (or Next) jump inside the wrapper.
    const onClick = (e: MouseEvent) => {
      if (!live || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href*='#']") : null;
      if (!a || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || url.hash.length < 2) return;
      let el: HTMLElement | null = null;
      try {
        el = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      } catch {
        return;
      }
      if (!el || !content.current?.contains(el)) return;
      e.preventDefault(); // Next's Link skips a prevented click; the link's own onClick (menus closing) still runs
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      live.scrollTo(el, true, `top ${margin}px`);
      if (location.hash !== url.hash) history.pushState(history.state, "", url.hash); // Back still returns
      if (el.id === "main") el.focus({ preventScroll: true }); // the skip link moves focus as well as the view
    };
    document.addEventListener("click", onClick, true);

    return () => {
      dead = true;
      document.removeEventListener("click", onClick, true);
      ro?.disconnect();
      pins.forEach((p) => p.kill());
      pins = [];
      s?.kill();
      if (live === s) live = null;
      clearSmoothEngine("smoother");
      document.documentElement.classList.remove("smoother");
      document.documentElement.style.removeProperty("--smooth-top");
      release();
    };
  }, []);

  // A new page: show it where the browser put the scroll (the top, or a restored spot) at once, with no glide from
  // the previous page's position. Runs before paint, after Next has scrolled.
  useIso(() => {
    if (!live) return;
    if (wrap.current) wrap.current.scrollTop = 0;
    live.scrollTo(window.scrollY, false);
    const root = content.current;
    if (!root) return;
    const f = requestAnimationFrame(() => pinSticky(root)); // the new page's sticky bars
    return () => cancelAnimationFrame(f);
  }, [path]);

  return (
    <div id="smooth-wrapper" ref={wrap}>
      <div id="smooth-content" ref={content}>
        {children}
      </div>
    </div>
  );
}
