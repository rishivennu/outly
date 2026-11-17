"use client";
import { gsapNow, loadGsap, type GsapApi } from "./gsap-lazy";
import { reduced, simple } from "./prefs";
import { GSAP_EASE, sec } from "./tokens";

type FlipPlugin = typeof import("gsap/Flip").Flip;
type FlipState = ReturnType<FlipPlugin["getState"]>;

/**
 * 1188: lists that rearrange instead of jumping (GSAP Flip).
 *
 * When the data under a list changes (a filter, a search, a sort, a page), every row or card that is still
 * there glides from where it was to where it is now, and only the genuinely new ones fade in. First and Last
 * positions are measured by Flip; nothing is tied to the scroll position and nothing overshoots.
 *
 * How a caller uses it:
 *   1. `loadFlip()` once the list is on screen (idle), so the plugin is there before the first click.
 *   2. `flipCapture(root)` the instant BEFORE the data changes (in the click handler, or while React renders
 *      the new rows: at that point the DOM still holds the old ones).
 *   3. `flipPlay(root, snapshot)` in a layout effect, after the new rows are in the DOM.
 *
 * Rows opt in with `data-flip-id="<stable id>"`. The same id before and after means "this is the same row".
 *
 * Reduced motion: nothing moves (the caller's plain fade stands in). Phones and low-power devices: skipped
 * too, a Flip measures and writes transforms on every row and that is the wrong bill on a weak device.
 * Only transform and opacity are touched, and both are cleared when the glide ends or is cut short.
 */
export const FLIP_ATTR = "data-flip-id";
const SEL = `[${FLIP_ATTR}]`;
const CLEAR = "opacity,transform,transition";
/** Past this many rows a Flip costs more than it gives (every row is measured twice). */
const MAX_ROWS = 120;

let plugin: FlipPlugin | null = null;
let loading: Promise<FlipPlugin | null> | null = null;

/** Flip is here: the plugin. Not yet: null (the caller leaves the list alone). */
export const flipNow = () => plugin;

/** Load GSAP and the Flip plugin once, on demand. Never throws: a failed load just means no glide. */
export function loadFlip(): Promise<FlipPlugin | null> {
  loading ??= Promise.all([loadGsap(), import("gsap/Flip")])
    .then(([g, m]) => {
      g.registerPlugin(m.Flip);
      return (plugin = m.Flip);
    })
    .catch(() => {
      loading = null;
      return null;
    });
  return loading;
}

export type FlipSnapshot = { state: FlipState; ids: Set<string> } | null;

const rowsOf = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>(SEL));
const idOf = (el: HTMLElement) => el.getAttribute(FLIP_ATTR) ?? "";

/** Where every row in `root` sits right now. Call this before the list changes; null means "do not animate". */
export function flipCapture(root: Element | null): FlipSnapshot {
  const Flip = plugin;
  if (!root || !Flip || reduced() || simple()) return null;
  const els = rowsOf(root);
  if (!els.length || els.length > MAX_ROWS) return null;
  return { state: Flip.getState(els, { simple: true }), ids: new Set(els.map(idOf)) };
}

/**
 * Glide the rows that survived the change into their new places, and fade the new ones in.
 * `enter: false` leaves the new rows alone, for a list that already fades its own arrivals in.
 * Returns a stop function (React cleanup): it kills the tweens and clears every style they wrote.
 */
export function flipPlay(root: Element | null, snap: FlipSnapshot, opts?: { enter?: boolean }): () => void {
  const Flip = plugin;
  const gsap: GsapApi | null = gsapNow();
  if (!root || !snap || !Flip || !gsap || reduced() || simple()) return () => {};
  const els = rowsOf(root);
  const kept = els.filter((e) => snap.ids.has(idOf(e)));
  const fresh = opts?.enter === false ? [] : els.filter((e) => !snap.ids.has(idOf(e)));
  if (!kept.length && !fresh.length) return () => {};
  const touched = [...kept, ...fresh];
  gsap.set(touched, { transition: "none" });
  const done = () => gsap.set(touched, { clearProps: CLEAR });
  const anims: { kill: () => void }[] = [];
  if (kept.length) {
    anims.push(
      Flip.from(snap.state, {
        targets: kept,
        duration: sec("card"),
        ease: GSAP_EASE.smooth, // power2.inOut: leaves gently, travels evenly, lands soft. No overshoot.
        stagger: { amount: 0.12, from: "start" }, // the whole wave is over inside the card duration
        absolute: false,
        prune: true, // a row that did not move is left completely alone
        nested: false,
        scale: false,
        onComplete: done,
        onInterrupt: done,
      }),
    );
  }
  if (fresh.length) {
    anims.push(
      gsap.fromTo(
        fresh,
        { opacity: 0, y: 10 },
        {
          opacity: 1,
          y: 0,
          duration: sec("nav"),
          ease: GSAP_EASE.out,
          delay: kept.length ? 0.08 : 0, // the movers set off first, then the new rows arrive
          stagger: 0.03,
          clearProps: CLEAR,
          onInterrupt: done,
        },
      ),
    );
  }
  return () => {
    anims.forEach((a) => a.kill());
    done();
  };
}
