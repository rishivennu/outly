import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { scrollPageTo, smoothEngine } from "./smooth";

gsap.registerPlugin(ScrollTrigger);

/**
 * 1183: the GSAP "horizontal scrolling gallery" demo (user, 11-17) for the landing's What you get and Try it rows.
 * The section holds still while the vertical scroll drives its card track sideways, one pixel across per pixel down,
 * and each card grows into place as it arrives from the right edge.
 *
 * Markup: components/marketing/HScroll.tsx ([data-hscroll] > [data-hs-box] > [data-hs-track] > .hs-item). Without this
 * (no JS, reduced motion) the box is a native sideways scroller with snap points; data-hs-on turns that off.
 *
 * Pins cannot nest, so this never pins inside a pinned landing sheet: the sheet holds for `screens()` while its hold
 * progress calls `drive` (lib/motion/panels.ts), exactly like How it works and Demo. `pin()` is the fallback for a
 * gallery whose sheet is not pinned (the last sheet, or no stack at all).
 */
export type HScroll = {
  /** How many screens of scroll the track needs to run end to end. */
  screens: () => number;
  /** Move the track to p (0: first card at the left edge, 1: last card's right edge at the right edge). */
  drive: (p: number) => void;
  /** Tell the gallery which page scroll shows progress p, so focus can bring a card into view. */
  bind: (toScroll: (p: number) => number) => void;
  pin: () => void;
  kill: () => void;
};

const clamp = gsap.utils.clamp(0, 1);

export function hscroll(root: HTMLElement): HScroll | null {
  const box = root.querySelector<HTMLElement>("[data-hs-box]");
  const track = root.querySelector<HTMLElement>("[data-hs-track]");
  if (!box || !track) return null;
  const items = Array.from(track.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
  const touch = matchMedia("(pointer: coarse)").matches;
  const tab = box.getAttribute("tabindex");
  root.setAttribute("data-hs-on", "");
  // The box only needs a tab stop while it scrolls itself; now the page scroll moves the track.
  if (tab !== null) box.removeAttribute("tabindex");
  box.scrollLeft = 0;

  let dist = 0;
  let vw = 0;
  let boxLeft = 0;
  let offs: number[] = [];
  let ws: number[] = [];
  // Layout positions, never getBoundingClientRect: the sheet around the gallery is scaled while it sinks.
  const leftOf = (el: HTMLElement) => {
    let x = 0;
    for (let e: HTMLElement | null = el; e; e = e.offsetParent as HTMLElement | null) x += e.offsetLeft;
    return x;
  };
  const measure = () => {
    vw = document.documentElement.clientWidth;
    dist = Math.max(0, track.scrollWidth - box.clientWidth);
    boxLeft = leftOf(box);
    offs = items.map((el) => el.offsetLeft);
    ws = items.map((el) => el.offsetWidth);
  };

  const setX = gsap.quickSetter(track, "x", "px") as (v: number) => void;
  const fx = items.map((el) => ({
    scale: gsap.quickSetter(el, "scale") as (v: number) => void,
    rotate: gsap.quickSetter(el, "rotation", "deg") as (v: number) => void,
    y: gsap.quickSetter(el, "y", "px") as (v: number) => void,
    opacity: gsap.quickSetter(el, "opacity") as (v: number) => void,
  }));
  items.forEach((el) => gsap.set(el, { transformOrigin: "0% 100%" }));

  const now = { p: 0 }; // what is painted
  let goal = 0; // where the scroll says it should be
  const render = () => {
    const x = -now.p * dist;
    setX(x);
    items.forEach((_, i) => {
      // 0 while the card is still past the right edge, 1 once most of it is on screen.
      const e = clamp((vw - (boxLeft + offs[i] + x)) / Math.max(1, ws[i] * 0.85));
      const a = 1 - (1 - e) * (1 - e);
      fx[i].scale(0.86 + 0.14 * a);
      fx[i].rotate(5 * (1 - a));
      fx[i].y(28 * (1 - a));
      fx[i].opacity(0.35 + 0.65 * a);
    });
  };
  measure();
  render();

  // Phones scroll natively, so the track takes a short ease to follow; ScrollSmoother already smooths the desktop.
  let ease: gsap.core.Tween | null = null;
  const glide = (smooth: boolean) => {
    ease?.kill();
    if (!smooth) {
      now.p = goal;
      render();
    } else ease = gsap.to(now, { p: goal, duration: 0.45, ease: "power3.out", onUpdate: render });
  };
  // While a phone keyboard is up the browser may nudge the page to keep the field in view: the track stays still
  // under the typing and catches up when the field lets go.
  let frozen = false;
  const drive = (p: number) => {
    goal = clamp(p);
    if (!frozen) glide(touch && smoothEngine()?.kind !== "smoother");
  };

  let toScroll: ((p: number) => number) | null = null;
  /** Scroll the page to the progress that shows `item` whole, if it is not already. */
  const show = (item: HTMLElement) => {
    const i = items.indexOf(item);
    if (i < 0 || !toScroll || !dist) return;
    const x = -goal * dist;
    const left = offs[i] + x;
    let nx = x;
    if (left < 0) nx = -offs[i];
    else if (left + ws[i] > box.clientWidth) nx = box.clientWidth - offs[i] - ws[i];
    else return;
    scrollPageTo(Math.round(toScroll(clamp(-nx / dist))));
  };
  const itemOf = (t: EventTarget | null) => (t instanceof Element ? items.find((el) => el.contains(t)) ?? null : null);

  const typing = (t: EventTarget | null) => touch && t instanceof HTMLElement && t.matches("input, textarea");
  const onFocusIn = (e: FocusEvent) => {
    if (typing(e.target)) {
      frozen = true;
      return;
    }
    // Keyboard focus only: a tapped or clicked card is already where the visitor is looking.
    const t = e.target as HTMLElement;
    const item = itemOf(t);
    if (item && t.matches(":focus-visible")) requestAnimationFrame(() => show(item));
  };
  const onFocusOut = (e: FocusEvent) => {
    if (!typing(e.target)) return;
    frozen = false;
    glide(true);
  };
  const onShow = (e: Event) => {
    const item = itemOf(e.target);
    if (item) show(item);
  };
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("hs:show", onShow);

  // Results that arrive later (Try it drafts) and fonts change card sizes: measure again, at most once a frame.
  let raf = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      measure();
      render();
    });
  });
  ro.observe(track);
  ro.observe(box);
  const onRefresh = () => {
    measure();
    render();
  };
  ScrollTrigger.addEventListener("refresh", onRefresh);

  let own: ScrollTrigger | null = null;
  return {
    screens: () => {
      measure();
      return dist / innerHeight;
    },
    drive,
    bind: (f) => void (toScroll = f),
    pin: () => {
      const section = root.closest<HTMLElement>("section") ?? root;
      own = ScrollTrigger.create({
        trigger: section,
        start: () => (section.offsetHeight > innerHeight ? "bottom bottom" : "center center"),
        end: () => `+=${Math.max(1, Math.round(dist))}`,
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (st) => drive(st.progress),
        onRefresh: (st) => drive(st.progress),
      });
      const st = own;
      toScroll = (p) => st.start + p * (st.end - st.start);
    },
    kill: () => {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("hs:show", onShow);
      ScrollTrigger.removeEventListener("refresh", onRefresh);
      ro.disconnect();
      cancelAnimationFrame(raf);
      ease?.kill();
      own?.kill(true);
      gsap.set(track, { clearProps: "transform" });
      gsap.set(items, { clearProps: "transform,opacity,transformOrigin" });
      root.removeAttribute("data-hs-on");
      if (tab !== null) box.setAttribute("tabindex", tab);
    },
  };
}
