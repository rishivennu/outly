"use client";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * The one scroll-reveal engine (10-22; 1064 cinematic pass). Every <Reveal> registers its element here;
 * ScrollTrigger.batch groups whatever enters view in the same moment, so a row of cards arrives as one
 * staggered wave instead of each card guessing its own delay.
 *
 * 1064: entrances are masks, not fades. Each block is uncovered through a clip-path window (a wipe in its
 * reading direction, an iris that opens out with a little depth, or a sideways wipe away from the card that
 * led) while it travels a short way into place. Opacity only carries the first few frames.
 *
 * - Hidden state lives in CSS under html.js, so nothing flashes before hydration and nothing is lost
 *   without JS. If the engine never registers anything (html.rv-on stays off), a CSS failsafe shows
 *   everything after 3s.
 * - CSS transitions on a target are switched off for the length of its tween (Tailwind `transition`
 *   classes would otherwise ease every GSAP frame and make the entrance lag), then restored.
 * - data-shown is still set on reveal: CSS that keys off it (section-head word masks, icon pops, the
 *   bento graph draw) plays in step with the GSAP entrance.
 * - Only opacity, transform and clip-path are tweened, and all three are cleared at the end, so hover
 *   transforms, shadows and sticky headers behave exactly as before.
 * - Timing (1064 brief): small pieces about .5s, cards .6 to .75s, composed scenes up to .9s, staggers
 *   60 to 110ms. No overshoot anywhere.
 * - Phones, low-power devices and Save-Data: a short lift and fade, no clipping (a clip-path repaints).
 *   Reduced motion: a short opacity fade, no movement, no stagger.
 */
export type RevealFx = "rise" | "depth" | "wipe" | "stagger" | "cards" | "tiles" | "rows" | "footer";

const EASE = "expo.out"; // fast start, long soft landing, no overshoot
const CLIP_EASE = "power3.out"; // the mask opens a touch slower than the block travels, so the edge reads
const CLEAR = "opacity,transform,transformOrigin,visibility,transition,clipPath";
const triggers = new Map<HTMLElement, ScrollTrigger>();
// Everything a registered block's entrance tweened (its children, tiles, rows, the plan pill, the demo's
// destination cards beside it), so unmounting it mid-entrance can stop and clear exactly those.
const owned = new Map<HTMLElement, Set<HTMLElement>>();
let owner: Set<HTMLElement> | null = null;
const pending = new Map<HTMLElement, gsap.core.Tween>(); // section heads waiting on their delay
const queue = new Set<HTMLElement>();
let raf = 0;

export const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
// Phones: a short lift and fade only. Big slides while the finger is still scrolling cost frames on low-end devices.
const coarse = () => typeof matchMedia !== "undefined" && matchMedia("(hover: none) and (pointer: coarse)").matches;
let weak: boolean | null = null;
/** Low-power hint: Save-Data, or a small machine (few cores and little memory). Cached, it never changes mid-visit. */
const lowPower = () => {
  if (weak !== null) return weak;
  const n = (typeof navigator !== "undefined" ? navigator : {}) as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  weak = !!n.connection?.saveData || ((n.hardwareConcurrency ?? 8) <= 4 && (n.deviceMemory ?? 8) <= 4);
  return weak;
};
export const simple = () => coarse() || lowPower();
const num = (el: HTMLElement, v: string, d: number) => {
  const n = parseFloat(el.style.getPropertyValue(v));
  return Number.isFinite(n) ? n : d;
};
const kids = (el: Element, sel: string) => Array.from(el.querySelectorAll<HTMLElement>(sel));
const shown = (el: HTMLElement) => {
  el.dataset.shown = "";
};

/**
 * A clip-path inset window (top right bottom left, as fractions of the element's own size, 0 = side open).
 * Written in px so the start and end strings share units (GSAP tweens the numbers in place). An open side
 * sits PAD px outside the box, so card shadows are never cut off mid-reveal and nothing changes when the
 * clip is cleared at the end. Rounded like the element, so corners stay true while it opens.
 */
type Box = [number, number, number, number];
const OPEN: Box = [0, 0, 0, 0];
const PAD = 56;
function inset(el: HTMLElement, box: Box) {
  const w = el.offsetWidth, h = el.offsetHeight;
  const [t, r, b, l] = box.map((f, i) => (f > 0 ? Math.round(f * (i % 2 ? w : h)) : -PAD));
  // A plain wrapper around one rounded card (<Reveal><article class="rounded-…">) borrows the card's corners.
  // First token only: an elliptical corner computes to two lengths, which inset() would read as two corners.
  let rad = getComputedStyle(el).borderTopLeftRadius.split(" ")[0];
  if ((!rad || rad === "0px") && el.children.length === 1) rad = getComputedStyle(el.children[0]).borderTopLeftRadius.split(" ")[0];
  const round = rad && rad !== "0px" ? ` round ${rad}` : "";
  return `inset(${t}px ${r}px ${b}px ${l}px${round})`;
}
/** Which way a block is uncovered. "up" = the window opens from the top edge down, in reading order. */
export type Dir = "up" | "down" | "left" | "right" | "iris";
const WINDOW: Record<Dir, Box> = {
  up: [0, 0, 0.34, 0], // bottom third covered, opening downward while the block rises
  down: [0.34, 0, 0, 0],
  left: [0, 0, 0, 0.42], // covered from the left, so it opens toward the left (grows away from a lead on its right)
  right: [0, 0.42, 0, 0],
  iris: [0.07, 0.06, 0.07, 0.06],
};
const TRAVEL: Record<Dir, gsap.TweenVars> = {
  up: { y: 26 },
  down: { y: -18 },
  left: { x: 22 },
  right: { x: -22 },
  iris: { y: 24, scale: 0.965 },
};

type Opts = { delay?: number; stagger?: number | gsap.StaggerVars; duration?: number; dir?: Dir | ((el: HTMLElement, i: number) => Dir); travel?: number };

/**
 * Bring `targets` in through a mask. Returns nothing and cleans up after itself (every inline style it set
 * is cleared at the end). `travel` scales the default distances.
 */
function reveal(targets: HTMLElement[] | HTMLElement, { delay = 0, stagger = 0, duration = 0.62, dir = "up", travel = 1 }: Opts = {}) {
  const list = Array.isArray(targets) ? targets : [targets];
  if (!list.length) return;
  list.forEach((t) => owner?.add(t));
  gsap.set(list, { transition: "none" });
  // Killed early (unmount, Fast Refresh, a second reveal of the same list): drop every inline style at once,
  // so an interrupted entrance leaves the content plainly visible rather than hidden or half masked.
  const clear = () => gsap.set(list, { clearProps: CLEAR });
  if (reduced()) {
    gsap.fromTo(list, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "none", clearProps: CLEAR, delay: Math.min(delay, 0.2), onInterrupt: clear });
    return;
  }
  const each = typeof stagger === "number" ? stagger : 0;
  if (simple()) {
    const st = typeof stagger === "number" ? Math.min(stagger, 0.05) : stagger;
    gsap.fromTo(list, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out", clearProps: CLEAR, delay, stagger: st, onInterrupt: clear });
    return;
  }
  const dirOf = (el: HTMLElement, i: number) => (typeof dir === "function" ? dir(el, i) : dir);
  const at = (i: number) => delay + (typeof stagger === "number" ? i * each : 0);
  // Function-based values keep it one tween per property set, with each target on its own direction.
  const from = (i: number, el: HTMLElement) => {
    const d = dirOf(el, i);
    const t = TRAVEL[d];
    return { x: ((t.x as number) ?? 0) * travel, y: ((t.y as number) ?? 0) * travel, scale: (t.scale as number) ?? 1, clip: inset(el, WINDOW[d]), open: inset(el, OPEN) };
  };
  const plans = list.map((el, i) => from(i, el));
  gsap.set(list, { opacity: 0, x: (i) => plans[i].x, y: (i) => plans[i].y, scale: (i) => plans[i].scale, clipPath: (i) => plans[i].clip, transformOrigin: "50% 60%" });
  const timed = typeof stagger === "number" ? { delay: (i: number) => at(i) } : { delay, stagger };
  // Opacity only covers the first beat, so the mask does the revealing and text is readable almost at once.
  gsap.to(list, { opacity: 1, duration: Math.min(0.32, duration * 0.5), ease: "power1.out", ...timed, onInterrupt: clear });
  gsap.to(list, { x: 0, y: 0, scale: 1, duration, ease: EASE, ...timed, onInterrupt: clear });
  gsap.to(list, { clipPath: (i) => plans[i].open, duration: duration * 1.05, ease: CLIP_EASE, ...timed, onComplete: clear, onInterrupt: clear });
}

/**
 * Bento: the lead tile (the largest, or the first in DOM order for a story told in steps) opens first as an
 * iris; every other tile then wipes outward from it, in order of distance: tiles beside it open sideways,
 * away from it, tiles under it open downward.
 */
function bento(tiles: HTMLElement[], delay: number, domOrder: boolean) {
  if (!tiles.length) return;
  const box = new Map(tiles.map((t) => [t, t.getBoundingClientRect()]));
  const area = (t: HTMLElement) => box.get(t)!.width * box.get(t)!.height;
  const lead = domOrder ? tiles[0] : tiles.reduce((a, b) => (area(b) > area(a) ? b : a));
  const L = box.get(lead)!;
  const cx = L.left + L.width / 2, cy = L.top + L.height / 2;
  const rest = tiles.filter((t) => t !== lead);
  const dist = (t: HTMLElement) => {
    const r = box.get(t)!;
    return Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
  };
  const ordered = domOrder ? rest : [...rest].sort((a, b) => dist(a) - dist(b));
  const dirFor = (t: HTMLElement): Dir => {
    const r = box.get(t)!;
    const dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
    if (Math.abs(dx) > Math.abs(dy) * 0.8) return dx > 0 ? "right" : "left";
    return dy > 0 ? "up" : "down";
  };
  reveal(lead, { delay, dir: "iris", duration: 0.8 });
  reveal(ordered, { delay: delay + 0.16, stagger: 0.09, duration: 0.7, dir: (el) => dirFor(el) });
}

function play(el: HTMLElement, order: number) {
  const mine = owned.get(el) ?? new Set<HTMLElement>();
  owned.set(el, mine);
  owner = mine;
  try {
    enter(el, order);
  } finally {
    owner = null;
  }
}

function enter(el: HTMLElement, order: number) {
  const fx = (el.dataset.rv as RevealFx | undefined) ?? (el.hasAttribute("data-stagger") ? "stagger" : "rise");
  const delay = num(el, "--reveal-delay", 0) + order * 0.08;
  const y = num(el, "--reveal-y", 24);
  const travel = Math.max(0.4, Math.min(1.8, (y || 24) / 24));

  // Section heads move nothing themselves: the eyebrow, word masks and body are CSS keyed off data-shown.
  if (el.classList.contains("rv-head")) {
    if (delay) pending.set(el, gsap.delayedCall(delay, () => { pending.delete(el); shown(el); }));
    else shown(el);
    return;
  }

  switch (fx) {
    case "stagger": {
      reveal(Array.from(el.children) as HTMLElement[], { delay, stagger: 0.08, duration: 0.6, travel });
      break;
    }
    case "depth": {
      reveal(el, { delay, dir: "iris", duration: 0.72, travel });
      break;
    }
    case "wipe": {
      // Sideways, in reading order by default (uncovered left to right); data-dir="left" runs it the other way.
      reveal(el, { delay, dir: el.dataset.dir === "left" ? "left" : "right", duration: 0.7, travel });
      break;
    }
    case "cards": {
      // Pricing: the recommended plan opens first (an iris, no overshoot); its neighbours wipe outward from it.
      // Its "Popular" pill wipes on just after it lands: that, and leading, is all the emphasis it gets.
      const cards = Array.from(el.children) as HTMLElement[];
      const hot = cards.findIndex((c) => c.querySelector(".pc-hot"));
      const mid = hot >= 0 ? hot : Math.floor((cards.length - 1) / 2);
      const leadCard = cards[mid];
      const top = leadCard?.getBoundingClientRect().top ?? 0;
      const rest = cards.filter((c) => c !== leadCard);
      if (leadCard) {
        reveal(leadCard, { delay, dir: "iris", duration: 0.75, travel: 1.3 });
        const pill = leadCard.querySelector<HTMLElement>(".pc-hot .pc-pill");
        if (pill) reveal(pill, { delay: delay + 0.42, dir: "right", duration: 0.5, travel: 0.4 });
      }
      reveal(rest, {
        delay: delay + 0.12,
        stagger: 0.1,
        duration: 0.7,
        // Same row: open away from the lead. Wrapped onto a row below (tablet): open downward.
        dir: (c) => (Math.abs(c.getBoundingClientRect().top - top) > 40 ? "up" : cards.indexOf(c) < mid ? "left" : "right"),
      });
      break;
    }
    case "tiles": {
      bento(kids(el, ".bx-tile"), delay, el.classList.contains("bx-demo"));
      // Demo: the destination cards follow the story tiles, one after another, each opening downward.
      const dest = el.parentElement?.querySelector<HTMLElement>(":scope > .la-demo");
      if (dest) reveal(Array.from(dest.children) as HTMLElement[], { delay: delay + 0.5, stagger: 0.11, duration: 0.65 });
      break;
    }
    case "rows": {
      // Comparison: the tool header drops in, then each group card, then the open group's rows in threes.
      const bar = kids(el, "[data-cmp] > .sticky");
      const groups = kids(el, "details[data-cmp-group]");
      reveal(bar, { delay, dir: "down", duration: 0.55 });
      reveal(groups, { delay: delay + 0.12, stagger: 0.09, duration: 0.65 });
      for (const g of groups) if ((g as HTMLDetailsElement).open) rowsIn(g, delay + 0.3);
      reveal(kids(el, "[data-cmp] > p, [data-cmp] > div:not(.sticky), [data-cmp] > ul"), { delay: delay + 0.2, stagger: 0.06, duration: 0.5, travel: 0.5 });
      break;
    }
    case "footer": {
      reveal(el, { delay, dir: "iris", duration: 0.85, travel: 1.6 });
      reveal(kids(el, ":scope > div:first-child > div:first-child, nav"), { delay: delay + 0.15, stagger: 0.08, duration: 0.6, travel: 0.8 });
      // The hairlines draw across instead of fading.
      const rules = kids(el, ".ft-rule");
      rules.forEach((r) => owner?.add(r));
      if (rules.length && !reduced() && !simple()) {
        gsap.fromTo(rules, { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.9, ease: CLIP_EASE, delay: delay + 0.35, stagger: 0.08, clearProps: "transform,transformOrigin", onInterrupt: () => gsap.set(rules, { clearProps: "transform,transformOrigin" }) });
      }
      break;
    }
    default:
      reveal(el, { delay, travel });
  }
  shown(el);
}

/** The rows of one comparison group, in groups of three (used on reveal and when a group is opened). */
export function rowsIn(group: HTMLElement, delay = 0) {
  const rows = kids(group, ":scope > ul > li");
  if (!rows.length || reduced()) return;
  rows.forEach((r) => owner?.add(r));
  gsap.set(rows, { transition: "none" });
  gsap.fromTo(
    rows,
    { opacity: 0, y: 18 },
    { opacity: 1, y: 0, duration: 0.55, ease: EASE, clearProps: CLEAR, onInterrupt: () => gsap.set(rows, { clearProps: CLEAR }), delay: (i: number) => delay + Math.floor(i / 3) * 0.1 + (i % 3) * 0.035 },
  );
}

function flush() {
  raf = 0;
  const els = Array.from(queue).filter((e) => e.isConnected && !triggers.has(e));
  queue.clear();
  if (!els.length) return;
  const made = ScrollTrigger.batch(els, {
    start: "top 92%",
    // Measure after the pinned scenes (How it works, Demo: ScrollScenes.tsx). Reveals register first, so at the
    // default priority their starts ignored the pin spacing above them and every card below the first pin
    // played about a screen early, off screen (1038 fix).
    // batch() copies every var into each ScrollTrigger.create(), but its type leaves this one out.
    ...({ refreshPriority: -1 } as ScrollTrigger.BatchVars),
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
    // Stop everything this block's entrance tweened (each tween also clears its styles when interrupted),
    // then clear once more in case a tween was killed before it ever rendered.
    const mine = [el, ...(owned.get(el) ?? [])];
    owned.delete(el);
    gsap.killTweensOf(mine);
    gsap.set(mine, { clearProps: CLEAR });
  };
}

/**
 * Dashboard and admin: the page's top-level blocks settle in one after another when a route mounts.
 * Short on purpose (about half a second end to end), so working screens never wait on it.
 *
 * 1064: `x` adds a small sideways slide (studio route changes read as moving across, not reloading), and
 * blocks below the fold get one quiet entrance the first time they scroll into view. Only the blocks that
 * existed when the route mounted, once each: nothing re-animates while someone works with the page, and
 * whatever renders later (new rows, opened panels) just appears. Tables, charts and buttons inside are
 * usable the whole time: only opacity and transform move, never layout, never pointer events.
 */
export function pageStagger(root: HTMLElement | null, { delay = 0, duration = 0.55, y = 14, x = 0, below = false }: { delay?: number; duration?: number; y?: number; x?: number; below?: boolean } = {}) {
  if (!root || reduced()) return () => {};
  let host: HTMLElement = root;
  // Walk down single-child wrappers to the element that actually holds the page's sections.
  for (let i = 0; i < 4 && host.children.length === 1 && host.firstElementChild instanceof HTMLElement; i++) host = host.firstElementChild;
  const vh = innerHeight;
  const all = (Array.from(host.children) as HTMLElement[]).filter((e) => {
    const s = getComputedStyle(e);
    return !(s.position === "fixed" || s.position === "sticky" || s.display === "none") && e.getBoundingClientRect().height > 0;
  });
  const blocks = all.filter((e) => e.getBoundingClientRect().top < vh).slice(0, 10);
  const later = below ? all.filter((e) => e.getBoundingClientRect().top >= vh).slice(0, 16) : [];
  if (!blocks.length && !later.length) return () => {};
  const lite = simple();
  const tws: gsap.core.Tween[] = [];
  if (blocks.length) {
    gsap.set(blocks, { transition: "none" });
    tws.push(gsap.fromTo(blocks, { opacity: 0, y, x: lite ? 0 : x }, { opacity: 1, y: 0, x: 0, duration, delay, ease: EASE, stagger: 0.045, clearProps: CLEAR }));
  }
  let io: IntersectionObserver | null = null;
  let fallback = 0;
  if (later.length && typeof IntersectionObserver !== "undefined") {
    gsap.set(later, { transition: "none", opacity: 0, y: 12 });
    io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
        if (!hit.length) return;
        hit.forEach((e) => io?.unobserve(e));
        gsap.set(hit, { transition: "none" });
        tws.push(gsap.to(hit, { opacity: 1, y: 0, duration: 0.5, ease: EASE, stagger: 0.06, clearProps: CLEAR }));
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    later.forEach((e) => io!.observe(e));
    // Failsafe: a block that is on screen yet never reported as intersecting (an odd scroll container) is shown
    // anyway after a few seconds, so nothing on a working screen can stay invisible.
    fallback = window.setTimeout(() => {
      const stuck = later.filter((e) => e.isConnected && e.style.opacity === "0" && e.getBoundingClientRect().top < innerHeight);
      stuck.forEach((e) => io?.unobserve(e));
      if (stuck.length) gsap.set(stuck, { clearProps: CLEAR });
    }, 4000);
  }
  return () => {
    clearTimeout(fallback);
    io?.disconnect();
    tws.forEach((t) => t.kill());
    gsap.set([...blocks, ...later], { clearProps: CLEAR });
  };
}
