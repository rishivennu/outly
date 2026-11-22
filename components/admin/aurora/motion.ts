"use client";
import type { RefObject } from "react";
import { gsap, useGSAP, countUp, settleCounts } from "@/lib/motion/gsap";
import { MOTION_OK, reduced } from "@/lib/motion/prefs";
import { GSAP_EASE, STAGGER, STAGGER_CAP, sec } from "@/lib/motion/tokens";

/**
 * R1304: motion for the Aurora design (components/admin/aurora). Everything here is GSAP on the shared
 * instance (lib/motion/gsap), with the console's eases and durations (lib/motion/tokens): nothing bounces,
 * nothing overshoots, nothing runs past 0.7 s, and reduced motion means the final state with no tween.
 */
export const AURORA_FX = {
  /** Cards rise this many px as they fade in. */
  cardY: 14,
  cardDur: sec("card"),
  /** Stagger between cards (s); the wave never adds more than STAGGER_CAP in total. */
  stagger: STAGGER / 1000,
  staggerCap: STAGGER_CAP / 1000,
  /** The sliding ink under the active nav tab. */
  inkDur: sec("nav"),
  /** The count-up on KPI numbers. */
  countDur: 0.6,
} as const;

/** Browsers with View Transitions expose this on document. */
type ViewTransitionDoc = Document & { startViewTransition?: (update: () => void | Promise<void>) => { ready: Promise<void>; finished: Promise<void> } };

/**
 * Stagger every [data-aurora="card"] inside `scope` up and in once, and count [data-aurora="count"] numbers up
 * from zero to their data-count text. Runs again when `deps` change (the Overview passes its route key).
 * Reduced motion: cards are simply there and numbers show their final text.
 */
export function useAuroraEnter(scope: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const cards = gsap.utils.toArray<HTMLElement>('[data-aurora="card"]', root);
      const counts = gsap.utils.toArray<HTMLElement>('[data-aurora="count"]', root);
      // The CSS reveal (aurora.css, [data-aurora-stage]:not([data-aurora-js])) covers the first paint before
      // hydration so server-rendered cards never flash in and then out; from here GSAP owns the entrance.
      root.dataset.auroraJs = "";
      cards.forEach((c) => (c.style.animation = "none"));
      if (!window.matchMedia(MOTION_OK).matches) {
        settleCounts(root);
        return;
      }
      const tl = gsap.timeline({ defaults: { ease: GSAP_EASE.out } });
      if (cards.length) {
        // long pages: the wave still finishes within staggerCap, so the last card is never held back
        const each = Math.min(AURORA_FX.stagger, AURORA_FX.staggerCap / Math.max(1, cards.length - 1));
        tl.fromTo(
          cards,
          { opacity: 0, y: AURORA_FX.cardY },
          { opacity: 1, y: 0, duration: AURORA_FX.cardDur, stagger: { each, from: "start" }, clearProps: "transform,opacity,animation" },
          0,
        );
      }
      counts.forEach((el, i) => countUp(tl, el, Math.min(i * AURORA_FX.stagger, AURORA_FX.staggerCap) + 0.1, AURORA_FX.countDur));
      return () => {
        tl.kill();
        settleCounts(root);
      };
    },
    { scope, dependencies: deps, revertOnUpdate: true },
  );
}

/**
 * Move the ink (the pill behind the active tab) under `to`, measured inside `strip` (the tab's offsetParent).
 * `animate` false (first paint, reduced motion, a resize) places it at once.
 */
export function slideInk(ink: HTMLElement, to: HTMLElement, strip: HTMLElement, animate: boolean) {
  const s = strip.getBoundingClientRect();
  const t = to.getBoundingClientRect();
  const x = t.left - s.left + strip.scrollLeft;
  const vars = { x, width: t.width, opacity: 1 };
  if (!animate || !window.matchMedia(MOTION_OK).matches) {
    gsap.set(ink, vars);
    return;
  }
  gsap.to(ink, { ...vars, duration: AURORA_FX.inkDur, ease: GSAP_EASE.out, overwrite: "auto" });
}

/** Hide the ink (no tab in this strip is active). */
export function hideInk(ink: HTMLElement) {
  gsap.set(ink, { opacity: 0 });
}

/**
 * Change the page as one cross-fade (View Transitions where supported), used for the design switch, where the
 * whole shell is replaced after the server re-renders. `update` may return a promise: the old frame is held
 * until it settles, then the new one fades in. Browsers without View Transitions, and reduced motion, just run
 * `update`.
 */
export async function crossfade(update: () => void | Promise<void>): Promise<void> {
  const doc = document as ViewTransitionDoc;
  if (reduced() || typeof doc.startViewTransition !== "function") {
    await update();
    return;
  }
  const el = document.documentElement;
  el.dataset.themeSwitch = "";
  const t = doc.startViewTransition(update);
  t.ready.catch(() => {});
  try {
    await t.finished;
  } catch {
    // a second quick switch skipped this one: expected, not an error
  } finally {
    delete el.dataset.themeSwitch;
  }
}
