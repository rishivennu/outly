import { DUR, EASE, GSAP_EASE } from "./tokens";

/**
 * R1255: the fluid layer on top of the 1119 tokens. One set of open / close variants for every panel that is not a
 * Radix overlay (those keep their data-state CSS in globals.css), the shared hover pill and the press. Entering rides
 * EASE.out, leaving rides EASE.in, and a close always takes half the time of its open: the user has already decided,
 * so the way out should never hold them up. Pure data and math here; the hooks live in lib/motion/useFluid.ts.
 */
export const FLUID_EASE = { enter: EASE.out, exit: EASE.in, gsapEnter: GSAP_EASE.out, gsapExit: GSAP_EASE.in } as const;

/** A close takes this share of its open (the motion skill: a half to a third). */
export const EXIT_RATIO = 0.5;
const s = (ms: number) => Math.round(ms) / 1000;
const pair = (enterMs: number) => ({ enter: s(enterMs), exit: s(enterMs * EXIT_RATIO) });

export type PanelFrom = { x?: number; y?: number; xPercent?: number; yPercent?: number; scale?: number };
export type PanelVariant = { from: PanelFrom; enter: number; exit: number };

/** Seconds, for GSAP. Ranges from the R1255 brief: menus 180-280, drawers and sheets 250-400, popovers 150-220. */
export const PANEL = {
  /** Dropdowns and menus: drops a few px from its trigger and grows from 97%. */
  dropdown: { from: { y: -6, scale: 0.97 }, ...pair(DUR.menu) },
  /** Small popovers and notice panels. */
  popover: { from: { y: -4, scale: 0.98 }, ...pair(200) },
  /** A panel that rises from a trigger under it (the rail's bell, Pip). */
  rise: { from: { y: 8, scale: 0.98 }, ...pair(DUR.menu) },
  /** Side drawers slide in horizontally. */
  drawer: { from: { xPercent: 100 }, ...pair(DUR.nav + 20) },
  /** Bottom sheets glide up from the bottom. */
  sheet: { from: { yPercent: 100 }, ...pair(360) },
  /** Opened many times a day (the command palette): near-instant. */
  instant: { from: { y: -4, scale: 0.99 }, ...pair(160) },
} as const satisfies Record<string, PanelVariant>;
export type PanelName = keyof typeof PANEL;

/** Reduced motion: nothing travels, a short fade in and a shorter one out. */
export const FADE = { enter: 0.12, exit: 0.08 } as const;

/** The nav hover pill: appears in place, glides between items, retracts on leave. */
export const PILL = { enter: s(DUR.hover), move: 0.26, exit: s(DUR.hover * EXIT_RATIO), from: 0.94 } as const;

/** Press: a quick squeeze down, a slower settle back (the release is what the eye follows). */
export const PRESS = { down: 0.1, up: s(DUR.nav), min: 0.97, maxDim: 600 } as const;

/** How far to squeeze a control: ~3% for a button, less for a wide row so its edges never move more than ~8px. */
export function pressScale(w: number, h: number): number | null {
  const big = Math.max(w, h);
  if (!(big > 0) || big > PRESS.maxDim) return null;
  return Math.max(PRESS.min, 1 - Math.min(1 - PRESS.min, 8 / big));
}

export type Rect = { left: number; top: number; right: number; bottom: number };
export type Box = { x: number; y: number; w: number; h: number };

/**
 * Where the hover pill sits for an item, in the host's own coordinates (inside its border). `clip` is the visible part
 * of a scrolling list the item lives in: a half-hidden row gets a pill cut to what shows, a hidden one gets none.
 */
export function pillBox(item: Rect, host: Rect, border = { left: 0, top: 0 }, clip?: Rect | null): Box | null {
  const top = clip ? Math.max(item.top, clip.top) : item.top;
  const bottom = clip ? Math.min(item.bottom, clip.bottom) : item.bottom;
  const w = item.right - item.left;
  const h = bottom - top;
  if (w <= 0 || h <= 1) return null;
  return { x: item.left - host.left - border.left, y: top - host.top - border.top, w, h };
}
