"use client";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * The one scroll-reveal engine (10-22). Every <Reveal> registers its element here; ScrollTrigger.batch
 * groups whatever enters view in the same moment, so a row of cards arrives as one staggered wave instead
 * of each card guessing its own delay.
 *
 * - Hidden state lives in CSS under html.js, so nothing flashes before hydration and nothing is lost
 *   without JS. If the engine never registers anything (html.rv-on stays off), a CSS failsafe shows
 *   everything after 3s.
 * - CSS transitions on a target are switched off for the length of its tween (Tailwind `transition`
 *   classes would otherwise ease every GSAP frame and make the entrance lag), then restored.
 * - data-shown is still set on reveal: CSS that keys off it (section-head word masks, icon pops, the
 *   bento graph draw) plays in step with the GSAP entrance.
 * - Only opacity and transform are tweened, and both are cleared at the end so hover transforms and
 *   sticky headers behave exactly as before.
 * - Reduced motion: a short opacity fade, no movement, no stagger.
 */
export type RevealFx = "rise" | "stagger" | "cards" | "tiles" | "rows" | "footer";

const EASE = "expo.out"; // fast start, long soft landing, no overshoot
const CLEAR = "opacity,transform,visibility,transition";
const triggers = new Map<HTMLElement, ScrollTrigger>();
const pending = new Map<HTMLElement, gsap.core.Tween>(); // section heads waiting on their delay
const queue = new Set<HTMLElement>();
let raf = 0;

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
// Phones: a short lift and fade only. Big slides while the finger is still scrolling cost frames on low-end devices.
const coarse = () => typeof matchMedia !== "undefined" && matchMedia("(hover: none) and (pointer: coarse)").matches;
const num = (el: HTMLElement, v: string, d: number) => {
  const n = parseFloat(el.style.getPropertyValue(v));
  return Number.isFinite(n) ? n : d;
};
const kids = (el: Element, sel: string) => Array.from(el.querySelectorAll<HTMLElement>(sel));
const shown = (el: HTMLElement) => {
  el.dataset.shown = "";
};

/** Tween `targets` in from below; returns nothing, cleans up after itself. */
function rise(targets: HTMLElement[] | HTMLElement, from: gsap.TweenVars, to: gsap.TweenVars = {}) {
  const list = Array.isArray(targets) ? targets : [targets];
  if (!list.length) return;
  gsap.set(list, { transition: "none" });
  if (reduced()) {
    gsap.fromTo(list, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "none", clearProps: CLEAR, ...(to.delay ? { delay: Math.min(Number(to.delay) || 0, 0.2) } : {}) });
    return;
  }
  if (coarse()) {
    const y = typeof from.y === "number" ? Math.sign(from.y) * Math.min(Math.abs(from.y), 12) : 0;
    const { stagger, delay } = to;
    gsap.fromTo(list, { opacity: 0, y }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", clearProps: CLEAR, delay, stagger: typeof stagger === "number" ? Math.min(stagger, 0.05) : stagger ? 0.05 : 0 });
    return;
  }
  gsap.fromTo(list, { opacity: 0, ...from }, { opacity: 1, x: 0, y: 0, scale: 1, duration: 1.05, ease: EASE, clearProps: CLEAR, ...to });
}

/** Visual reading order (top-left first) for grids built column by column. */
function byPosition(list: HTMLElement[]) {
  const pos = new Map(list.map((e) => [e, e.getBoundingClientRect()]));
  return [...list].sort((a, b) => {
    const A = pos.get(a)!, B = pos.get(b)!;
    return A.top + A.left * 0.6 - (B.top + B.left * 0.6);
  });
}

function play(el: HTMLElement, order: number) {
  const fx = (el.dataset.rv as RevealFx | undefined) ?? (el.hasAttribute("data-stagger") ? "stagger" : "rise");
  const delay = num(el, "--reveal-delay", 0) + order * 0.08;
  const y = num(el, "--reveal-y", 24);

  // Section heads move nothing themselves: the eyebrow, word masks and body are CSS keyed off data-shown.
  if (el.classList.contains("rv-head")) {
    if (delay) pending.set(el, gsap.delayedCall(delay, () => { pending.delete(el); shown(el); }));
    else shown(el);
    return;
  }

  switch (fx) {
    case "stagger": {
      rise(Array.from(el.children) as HTMLElement[], { y: y || 24 }, { delay, stagger: 0.07 });
      break;
    }
    case "cards": {
      // Pricing: the middle (featured) plan lands first, the outer two follow it up.
      const cards = Array.from(el.children) as HTMLElement[];
      rise(cards, { y: (y || 24) + 46, scale: 0.955, transformOrigin: "50% 100%" }, { delay, stagger: { each: 0.11, from: "center" }, duration: 1.2 });
      break;
    }
    case "tiles": {
      // Bento: tiles rise in reading order across the columns.
      rise(byPosition(kids(el, ".bx-tile")), { y: 44, scale: 0.965 }, { delay, stagger: 0.07, duration: 1.15 });
      break;
    }
    case "rows": {
      // Comparison: the tool header drops in, then each group card, then the open group's rows in threes.
      const bar = kids(el, "[data-cmp] > .sticky");
      const groups = kids(el, "details[data-cmp-group]");
      rise(bar, { y: -18 }, { delay, duration: 0.9 });
      rise(groups, { y: 40 }, { delay: delay + 0.12, stagger: 0.09 });
      for (const g of groups) if ((g as HTMLDetailsElement).open) rowsIn(g, delay + 0.3);
      rise(kids(el, "[data-cmp] > p, [data-cmp] > div:not(.sticky), [data-cmp] > ul"), { y: 12 }, { delay: delay + 0.2, stagger: 0.05 });
      break;
    }
    case "footer": {
      rise(el, { y: 48 }, { delay, duration: 1.1 });
      rise(kids(el, ":scope > div:first-child > div:first-child, nav"), { y: 22 }, { delay: delay + 0.15, stagger: 0.07 });
      rise(kids(el, ".ft-rule"), { y: 10 }, { delay: delay + 0.4, stagger: 0.08 });
      break;
    }
    default:
      rise(el, { y }, { delay });
  }
  shown(el);
}

/** The rows of one comparison group, in groups of three (used on reveal and when a group is opened). */
export function rowsIn(group: HTMLElement, delay = 0) {
  const rows = kids(group, ":scope > ul > li");
  if (!rows.length || reduced()) return;
  gsap.set(rows, { transition: "none" });
  gsap.fromTo(
    rows,
    { opacity: 0, y: 18 },
    { opacity: 1, y: 0, duration: 0.8, ease: EASE, clearProps: CLEAR, delay: (i: number) => delay + Math.floor(i / 3) * 0.12 + (i % 3) * 0.035 },
  );
}

function flush() {
  raf = 0;
  const els = Array.from(queue).filter((e) => e.isConnected && !triggers.has(e));
  queue.clear();
  if (!els.length) return;
  const made = ScrollTrigger.batch(els, {
    start: "top 92%",
    once: true,
    interval: 0.08,
    batchMax: 9,
    onEnter: (batch) => (batch as HTMLElement[]).forEach((e, i) => {
      triggers.get(e)?.kill();
      triggers.delete(e);
      play(e, i);
    }),
  });
  els.forEach((e, i) => made[i] && !e.hasAttribute("data-shown") && triggers.set(e, made[i]));
}

/** Called by <Reveal> on mount; returns the cleanup for unmount. */
export function registerReveal(el: HTMLElement) {
  if (typeof window === "undefined") return () => {};
  document.documentElement.classList.add("rv-on");
  queue.add(el);
  if (!raf) raf = requestAnimationFrame(flush);
  return () => {
    queue.delete(el);
    triggers.get(el)?.kill();
    triggers.delete(el);
    pending.get(el)?.kill();
    pending.delete(el);
    // The engine tweens the wrapper, its children (stagger, cards) or its tiles/rows: stop all of them.
    gsap.killTweensOf([el, ...Array.from(el.querySelectorAll<HTMLElement>(":scope > *, .bx-tile, details, li"))]);
  };
}

/**
 * Dashboard and admin: the page's top-level blocks settle in one after another when a route mounts.
 * Short on purpose (about half a second end to end), so working screens never wait on it.
 */
export function pageStagger(root: HTMLElement | null, { delay = 0, duration = 0.55, y = 14 }: { delay?: number; duration?: number; y?: number } = {}) {
  if (!root || reduced()) return () => {};
  let host: HTMLElement = root;
  // Walk down single-child wrappers to the element that actually holds the page's sections.
  for (let i = 0; i < 4 && host.children.length === 1 && host.firstElementChild instanceof HTMLElement; i++) host = host.firstElementChild;
  const vh = innerHeight;
  const blocks = (Array.from(host.children) as HTMLElement[])
    .filter((e) => {
      const s = getComputedStyle(e);
      if (s.position === "fixed" || s.position === "sticky" || s.display === "none") return false;
      const r = e.getBoundingClientRect();
      return r.height > 0 && r.top < vh; // only what is on screen; the rest is already settled when you scroll to it
    })
    .slice(0, 10);
  if (!blocks.length) return () => {};
  gsap.set(blocks, { transition: "none" });
  const tw = gsap.fromTo(blocks, { opacity: 0, y }, { opacity: 1, y: 0, duration, delay, ease: EASE, stagger: 0.04, clearProps: CLEAR });
  return () => {
    tw.kill();
    gsap.set(blocks, { clearProps: CLEAR });
  };
}
