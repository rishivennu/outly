import type { GsapApi } from "./gsap-lazy";

/**
 * 1181: the marketing nav's two menus, built from the GSAP demos the user picked (demos.gsap.com). Each builder takes
 * the lazily loaded gsap (lib/motion/gsap-lazy.ts) and returns open / close / kill, so Nav.tsx never imports GSAP up
 * front. Both are skipped under prefers-reduced-motion (Nav.tsx shows and hides the menus instantly instead).
 *
 * These two are the only place the site uses a back ease (a small overshoot): the demos' exact feel, asked for by the
 * user in 1181. Everywhere else the 1119 rule stands (tests/round-1119-motion.test.ts).
 */
export type MenuMotion = { open: () => void; close: () => void; kill: () => void };

/** The phone menu button's two bars (a 20x20 viewBox): a burger at rest, a cross when open. */
export const BURGER = [{ x1: 3, y1: 7, x2: 17, y2: 7 }, { x1: 3, y1: 13, x2: 17, y2: 13 }] as const;
export const CROSS = [{ x1: 5, y1: 5, x2: 15, y2: 15 }, { x1: 15, y1: 5, x2: 5, y2: 15 }] as const;

/**
 * Desktop Product menu: "orchestrated easeReverse". One paused timeline; hover plays it, leaving reverses it, and
 * each tween carries its own easeReverse so the way out is a calm settle rather than the entrance run backwards.
 * Interruptible by design: re-entering mid-reverse just plays forward from where it is.
 */
export function islandMenu(
  gsap: GsapApi,
  o: { panel: HTMLElement; items: Element[]; chev?: Element | null; onHidden: () => void },
): MenuMotion {
  const tl = gsap.timeline({ paused: true, onReverseComplete: o.onHidden });
  if (o.chev) {
    tl.fromTo(o.chev, { rotation: 0 }, { rotation: 180, duration: 0.5, ease: "back.out", easeReverse: "power4.out" }, 0.12);
  }
  tl.fromTo(
    o.panel,
    { opacity: 0, yPercent: -10, scale: 0.6 },
    { opacity: 1, yPercent: 0, scale: 1, duration: 0.8, transformOrigin: "top center", ease: "back.out(2)", easeReverse: "power3.out" },
    0.1,
  );
  if (o.items.length) {
    tl.fromTo(o.items, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.32, ease: "power2.out", easeReverse: true, stagger: 0.05 }, 0.22);
  }
  return {
    open: () => void tl.timeScale(1).play(),
    close: () => void tl.timeScale(1).reverse(),
    kill: () => {
      tl.kill();
      gsap.set([o.panel, ...o.items, ...(o.chev ? [o.chev] : [])], { clearProps: "transform,opacity,transformOrigin" });
    },
  };
}

/**
 * Phone menu: "interruptible single timeline, different enter and exit". Three stacked cards slide in from the right
 * (a slight back.out), the links follow, then the timeline pauses at the end of the entrance. Closing plays on into a
 * different exit: the cards drop off the bottom, each at a random tilt, last card first. Closing mid-entrance
 * rewinds it 1.5x instead; opening mid-exit restarts the entrance.
 */
export function stackMenu(
  gsap: GsapApi,
  o: {
    bg: HTMLElement;
    cards: HTMLElement[];
    items: Element[];
    foot?: Element | null;
    bars?: [SVGLineElement, SVGLineElement] | null;
    onHidden: () => void;
  },
): MenuMotion {
  const tl = gsap.timeline({ paused: true, onReverseComplete: o.onHidden });
  tl.fromTo(o.bg, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out", easeReverse: "power4.out" }, 0)
    .fromTo(o.cards, { x: "110%" }, { x: "0%", duration: 0.6, ease: "back.out", easeReverse: "power3.in", stagger: 0.1 }, 0);
  if (o.items.length) {
    tl.fromTo(o.items, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 1.2, ease: "expo.out", easeReverse: "power3.in", stagger: 0.03 }, 0.1);
  }
  if (o.bars) {
    o.bars.forEach((bar, i) =>
      tl.fromTo(bar, { attr: { ...BURGER[i] } }, { attr: { ...CROSS[i] }, duration: 0.35, ease: "back.out(1.4)", easeReverse: "power3.out" }, 0.06),
    );
  }
  if (o.foot) tl.fromTo(o.foot, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out", easeReverse: "power4.out" }, 0.4);
  tl.addPause();
  const enterEnd = tl.duration();

  // The exit: a different motion, not the entrance reversed.
  if (o.bars) o.bars.forEach((bar, i) => tl.to(bar, { attr: { ...BURGER[i] }, duration: 0.2, ease: "power3.in" }, enterEnd));
  tl.to(o.cards, { y: "110vh", rotation: "random(-25, 25)", duration: 1, ease: "power3.in", stagger: { from: "end", each: 0.02 } }, enterEnd)
    .to(o.bg, { opacity: 0, duration: 0.3, ease: "power2.in" }, "<0.1");
  tl.call(o.onHidden, undefined, tl.duration());

  return {
    open: () => {
      tl.timeScale(1);
      if (tl.time() >= enterEnd) tl.restart();
      else tl.play();
    },
    close: () => {
      if (tl.time() < enterEnd) tl.timeScale(1.5).reverse();
      else tl.timeScale(1).play();
    },
    kill: () => {
      tl.kill();
      gsap.set([o.bg, ...o.cards, ...o.items, ...(o.foot ? [o.foot] : [])], { clearProps: "transform,opacity" });
      o.bars?.forEach((bar, i) => gsap.set(bar, { attr: { ...BURGER[i] } }));
    },
  };
}
