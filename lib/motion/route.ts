"use client";
import gsap from "gsap";
import { reduced, simple } from "./reveal";

/**
 * Route transitions for the studio and the admin console (1065). One language, three strengths:
 *
 * - "page": a different section (Home to Analytics). The whole stage is uncovered through a soft sideways
 *   mask while it fades up, and its top-level blocks follow a beat later, sliding a few pixels in the
 *   direction of travel (down the sidebar = from the right, back up = from the left).
 * - "detail": deeper or shallower inside one section (Tickets to one ticket, Create to Bulk). No mask: the
 *   blocks push in sideways, a little further, like opening a record.
 * - "tab": a sibling in a tab bar (Analytics: Overview to Instagram). The tab bar stays put; only the
 *   content under it slides, in the direction of the tab that was picked.
 *
 * Changing only the query (filters, search, pagination, ?tab=) is not a navigation: nothing replays.
 *
 * A route loader (any element with data-route-skeleton) arrives with the transition; when the real page
 * replaces it, the new blocks settle in place with a short fade instead of popping in (a MutationObserver
 * callback runs before the browser paints, so the page is never seen unstyled first).
 *
 * Only opacity, transform and clip-path move, and every inline style is cleared at the end (or the moment a
 * transition is cut short by the next click), so hover lifts, sticky headers and fixed bars work as before.
 * Reduced motion: a 160ms fade of the stage, nothing moves. Phones and low-power devices: no mask.
 * Nothing here blocks a click: pointer events and layout are never touched.
 */
export type RouteKind = "page" | "detail" | "tab";
export type RouteDir = 1 | -1;

const CLEAR = "opacity,transform,transition,clipPath";
const EASE = "expo.out";
const SKELETON = "[data-route-skeleton]";
// A block holding a non-portalled fixed overlay is only faded: a transform or clip on an ancestor would
// re-anchor or cut that overlay while the entrance runs.
const PINNED = ".fixed,[data-fixed]";
const pinned = (el: HTMLElement) => !!el.querySelector(PINNED);

/** Timings in seconds, inside the brief's ranges: page 300 to 450ms, tab 250 to 400ms. */
export const ROUTE_TIMING = {
  page: { mask: 0.42, fade: 0.24, block: 0.45, delay: 0.05, travel: 18, lift: 8, spread: 0.18 },
  detail: { mask: 0, fade: 0, block: 0.38, delay: 0, travel: 24, lift: 0, spread: 0.12 },
  tab: { mask: 0, fade: 0, block: 0.32, delay: 0, travel: 14, lift: 0, spread: 0.1 },
  settle: { block: 0.3, lift: 6, spread: 0.12 },
} as const;

const parts = (p: string) => p.split("/").filter(Boolean);

/** The section a path belongs to: its first segment after the area's base ("/admin/tickets/x" -> "tickets"). */
export function sectionOf(path: string, base = "") {
  const rest = path.startsWith(base) ? path.slice(base.length) : path;
  return parts(rest)[0] ?? "";
}

/**
 * Pure decision (unit tested): what kind of move prev -> next is, and which way it goes.
 * `tab` is the [from, to] index of both paths in one tab bar, when they share one.
 * `order` is their [from, to] index in the area's sidebar (-1 when absent).
 */
export function classify(prev: string | null, next: string, base = "", hints: { tab?: [number, number] | null; order?: [number, number] } = {}): { kind: RouteKind; dir: RouteDir } | null {
  if (!prev || prev === next) return null;
  const sign = (a: number, b: number): RouteDir => (b < a ? -1 : 1);
  if (hints.tab) return { kind: "tab", dir: sign(hints.tab[0], hints.tab[1]) };
  const inArea = !base || (prev.startsWith(base) && next.startsWith(base));
  if (inArea && sectionOf(prev, base) === sectionOf(next, base)) return { kind: "detail", dir: parts(next).length < parts(prev).length ? -1 : 1 };
  const [a, b] = hints.order ?? [-1, -1];
  return { kind: "page", dir: a < 0 || b < 0 ? 1 : sign(a, b) };
}

/** Index of the link that best matches a path (exact, else the longest parent). -1 when none does. */
export function linkIndex(hrefs: string[], path: string) {
  let best = -1;
  let len = -1;
  hrefs.forEach((h, i) => {
    const hit = path === h || (h !== "/" && path.startsWith(`${h}/`));
    if (hit && h.length > len) {
      best = i;
      len = h.length;
    }
  });
  return best;
}

const hrefsIn = (el: Element | null) => (el ? Array.from(el.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) => a.getAttribute("href")!.split("?")[0]) : []);

/** Read the hints from the page: the sidebar ([data-route-order]) and any tab bar ([data-route-tabs]). */
export function readHints(prev: string, next: string): { tab: [number, number] | null; order: [number, number] } {
  let tab: [number, number] | null = null;
  for (const bar of Array.from(document.querySelectorAll("[data-route-tabs]"))) {
    const h = hrefsIn(bar);
    const a = h.indexOf(prev), b = h.indexOf(next);
    if (a >= 0 && b >= 0) {
      tab = [a, b];
      break;
    }
  }
  const order = hrefsIn(document.querySelector("[data-route-order]"));
  return { tab, order: [linkIndex(order, prev), linkIndex(order, next)] };
}

const visible = (el: Element): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  const s = getComputedStyle(el);
  // Pinned and absolutely placed pieces (sticky bars, glows, screen-reader labels) stay where they are.
  return !(s.position === "fixed" || s.position === "sticky" || s.position === "absolute" || s.display === "none") && el.getBoundingClientRect().height > 0;
};

/**
 * The page's top-level blocks: walk down wrappers that hold one block each, stepping over anything marked
 * data-route-static (a persistent tab bar), and open up groups marked data-route-stagger (a row of metric
 * cards) so their members arrive one after another.
 */
export function blocksOf(root: HTMLElement) {
  let host: HTMLElement = root;
  const statics: HTMLElement[] = [];
  let live: HTMLElement[] = [];
  for (let i = 0; i < 6; i++) {
    // The loader fades itself in (a short CSS delay, so a fast load never flashes it); the stage leaves it be.
    const kids = Array.from(host.children).filter(visible).filter((k) => !k.matches(SKELETON));
    live = kids.filter((k) => !k.hasAttribute("data-route-static"));
    statics.push(...kids.filter((k) => k.hasAttribute("data-route-static")));
    if (live.length === 1 && live[0].children.length > 0 && !live[0].hasAttribute("data-route-stagger")) host = live[0];
    else break;
  }
  const blocks = live.flatMap((b) => (b.hasAttribute("data-route-stagger") ? Array.from(b.children).filter(visible).slice(0, 10) : [b]));
  return { statics, blocks };
}

// Every observer and failsafe a run starts is kept until the run stops: a second pass (the settle after a
// loader) must never cancel the first one's, or a block it hid would stay hidden.
type Run = { tweens: gsap.core.Animation[]; touched: Set<HTMLElement>; ios: IntersectionObserver[]; mo: MutationObserver | null; timers: number[] };
const newRun = (): Run => ({ tweens: [], touched: new Set(), ios: [], mo: null, timers: [] });
const halt = (run: Run) => {
  run.timers.forEach((t) => clearTimeout(t));
  run.ios.forEach((io) => io.disconnect());
  run.mo?.disconnect();
  run.tweens.forEach((t) => t.kill());
  gsap.set(Array.from(run.touched), { clearProps: CLEAR });
};

/** Slide blocks in: the ones on screen now, the rest once each as they scroll into view. */
function blocksIn(run: Run, blocks: HTMLElement[], from: gsap.TweenVars, duration: number, delay: number, spread: number) {
  const vh = innerHeight;
  const now = blocks.filter((b) => b.getBoundingClientRect().top < vh).slice(0, 12);
  const later = blocks.filter((b) => b.getBoundingClientRect().top >= vh).slice(0, 16);
  const each = now.length > 1 ? Math.min(0.045, spread / (now.length - 1)) : 0;
  const clear = (els: HTMLElement[]) => () => gsap.set(els, { clearProps: CLEAR });
  if (now.length) {
    now.forEach((b) => run.touched.add(b));
    gsap.set(now, { transition: "none" });
    const go = now.filter((b) => !pinned(b)), still = now.filter(pinned);
    if (go.length) run.tweens.push(gsap.fromTo(go, { opacity: 0, ...from }, { opacity: 1, x: 0, y: 0, duration, delay, ease: EASE, stagger: each, clearProps: CLEAR, onInterrupt: clear(go) }));
    if (still.length) run.tweens.push(gsap.fromTo(still, { opacity: 0 }, { opacity: 1, duration, delay, ease: EASE, clearProps: CLEAR, onInterrupt: clear(still) }));
  }
  if (later.length && typeof IntersectionObserver !== "undefined") {
    later.forEach((b) => run.touched.add(b));
    gsap.set(later, { transition: "none", opacity: 0 });
    gsap.set(later.filter((b) => !pinned(b)), { y: 12 });
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
        if (!hit.length) return;
        hit.forEach((e) => io.unobserve(e));
        const go = hit.filter((b) => !pinned(b)), still = hit.filter(pinned);
        if (go.length) run.tweens.push(gsap.to(go, { opacity: 1, y: 0, duration: 0.5, ease: EASE, stagger: 0.06, clearProps: CLEAR, onInterrupt: clear(go) }));
        if (still.length) run.tweens.push(gsap.to(still, { opacity: 1, duration: 0.5, ease: EASE, clearProps: CLEAR, onInterrupt: clear(still) }));
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    later.forEach((b) => io.observe(b));
    run.ios.push(io);
    // Failsafe: a block on screen that never reported in (an odd scroll container) is shown after 4s anyway.
    run.timers.push(
      window.setTimeout(() => {
        io.disconnect();
        const stuck = later.filter((e) => e.isConnected && e.style.opacity === "0");
        if (stuck.length) gsap.set(stuck, { clearProps: CLEAR });
      }, 4000),
    );
  }
}

/** The sideways window the stage opens through. Wide top and bottom margins, so only one edge ever shows. */
const mask = (dir: RouteDir) => (dir > 0 ? "inset(-30% 0% -30% 7%)" : "inset(-30% 7% -30% 0%)");
const OPEN = "inset(-30% 0% -30% 0%)";

/**
 * Play the entrance for a route that just rendered into `root`. Returns the cleanup, which stops everything
 * at once and leaves the page plainly visible: call it on the next navigation and on unmount.
 */
export function enterRoute(root: HTMLElement | null, kind: RouteKind, dir: RouteDir): () => void {
  const run = newRun();
  const stop = () => halt(run);
  if (!root || typeof window === "undefined") return () => {};

  if (reduced()) {
    run.touched.add(root);
    run.tweens.push(gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.16, ease: "none", clearProps: CLEAR, onInterrupt: () => gsap.set(root, { clearProps: CLEAR }) }));
    return stop;
  }

  const t = ROUTE_TIMING[kind];
  const lite = simple();
  if (kind === "page") {
    run.touched.add(root);
    const clip = !lite && !root.querySelector(PINNED);
    gsap.set(root, { opacity: 0, ...(clip ? { clipPath: mask(dir) } : {}) });
    run.tweens.push(gsap.to(root, { opacity: 1, duration: t.fade, ease: "power1.out" }));
    run.tweens.push(gsap.to(root, { ...(clip ? { clipPath: OPEN } : {}), duration: t.mask, ease: "power3.out", onComplete: () => gsap.set(root, { clearProps: CLEAR }), onInterrupt: () => gsap.set(root, { clearProps: CLEAR }) }));
  }
  const { statics, blocks } = blocksOf(root);
  // A tab bar that stays put only moves with a full page change, never with a switch between its own tabs.
  const moving = kind === "page" ? [...statics, ...blocks] : blocks;
  blocksIn(run, moving, { x: lite ? 0 : dir * t.travel, y: t.lift || (lite ? 8 : 0) }, t.block, t.delay, t.spread);

  // The loader came first: when the real page replaces it, settle the new blocks in place.
  if (root.querySelector(SKELETON) && typeof MutationObserver !== "undefined") {
    const mo = new MutationObserver(() => {
      if (root.querySelector(SKELETON)) return;
      mo.disconnect();
      run.mo = null;
      const s = ROUTE_TIMING.settle;
      blocksIn(run, blocksOf(root).blocks, { y: s.lift }, s.block, 0, s.spread);
    });
    mo.observe(root, { childList: true, subtree: true });
    run.mo = mo;
  }
  return stop;
}

/**
 * Data changed inside a page (a filter, a search, the next page of a list): a quick settle of the region
 * that changed, nothing else on the page moves. Reduced motion: nothing.
 */
export function settleRegion(el: HTMLElement | null): () => void {
  if (!el || reduced()) return () => {};
  gsap.set(el, { transition: "none" });
  const tw = gsap.fromTo(el, { opacity: 0.4, y: 4 }, { opacity: 1, y: 0, duration: 0.22, ease: "power2.out", clearProps: CLEAR, onInterrupt: () => gsap.set(el, { clearProps: CLEAR }) });
  return () => {
    tw.kill();
    gsap.set(el, { clearProps: CLEAR });
  };
}

/** An in-page tab panel took over (Settings categories): it slides in from the side of the tab picked. */
export function tabIn(panel: HTMLElement | null, dir: RouteDir): () => void {
  if (!panel) return () => {};
  const run = newRun();
  if (reduced()) {
    run.touched.add(panel);
    run.tweens.push(gsap.fromTo(panel, { opacity: 0 }, { opacity: 1, duration: 0.14, ease: "none", clearProps: CLEAR }));
  } else {
    const t = ROUTE_TIMING.tab;
    const kids = Array.from(panel.children).filter(visible);
    blocksIn(run, kids.length ? kids : [panel], { x: simple() ? 0 : dir * t.travel, y: simple() ? 6 : 0 }, t.block, 0, t.spread);
  }
  return () => halt(run);
}
