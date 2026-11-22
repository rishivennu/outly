"use client";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { MOTION_OK, simple } from "@/lib/motion/prefs";
import { GSAP_EASE } from "@/lib/motion/tokens";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const EASE = GSAP_EASE.out;
const CLEAR = "transform,opacity";
/** Scroll lag: px of trail per (px/s of scroll speed) / 90, capped, and how long after the last scroll it eases back. */
const LAG = { gain: 90, cap: 16, settle: 0.16 };
/** Pointer parallax: how far a mockup drifts toward the cursor inside its tile. */
const DRIFT = { x: 8, y: 6 };

const pieces = (root: HTMLElement, p: string) => Array.from(root.querySelectorAll<HTMLElement>(`[data-p="${p}"]`));
/** The resting CSS `rotate` of a piece, read before GSAP touches it (GSAP folds the individual transform properties
 * into its own transform on first contact and reports them as "none" from then on). */
const deg = (el: HTMLElement) => parseFloat(getComputedStyle(el).rotate) || 0;
const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/**
 * One mockup's entrance: a short time-based timeline over its pieces, built from their CSS end state (the from
 * values are set at once, so nothing flashes), played once when its tile is 85% up the screen (after the tile's own
 * reveal has opened it) and jumped to the end if the page already sits past it.
 *
 * Rotations are written relative to each piece's resting CSS tilt (`rotation: -8` means eight degrees short of it),
 * so the pieces land exactly on their stylesheet pose. At the end every inline style GSAP wrote is cleared and the
 * inline transform it rebuilds from a mid-float `translate` is dropped too, so the CSS idle float and the tile's
 * hover carry on from an untouched element.
 */
function entrance(root: HTMLElement) {
  const kind = root.dataset.anim;
  const tl = gsap.timeline({ paused: true, delay: 0.2, defaults: { ease: EASE, duration: 0.62 } });
  const all: HTMLElement[] = [];
  const from = (els: HTMLElement[], vars: gsap.TweenVars, to: gsap.TweenVars, at: gsap.Position = 0) => {
    if (!els.length) return;
    const tilts = els.map(deg);
    const rel = (v: gsap.TweenVars): gsap.TweenVars => (typeof v.rotation === "number" ? { ...v, rotation: (i: number) => tilts[i] + (v.rotation as number) } : v);
    all.push(...els);
    gsap.set(els, rel(vars));
    tl.to(els, rel(to), at);
  };
  switch (kind) {
    case "offer": {
      // The sheet lands, the brief slides out from behind it, its checks tick on, the accept pill pops.
      from(pieces(root, "offer"), { y: 48, rotation: 3, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 0.7 });
      from(pieces(root, "brief"), { x: -70, y: 50, rotation: -8, opacity: 0 }, { x: 0, y: 0, rotation: 0, opacity: 1, duration: 0.7 }, 0.12);
      from(pieces(root, "check"), { x: -10, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, stagger: 0.07 }, 0.34);
      from(pieces(root, "accept"), { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5 }, 0.42);
      break;
    }
    case "plan": {
      from(pieces(root, "planBack"), { y: -26, rotation: 4, opacity: 0 }, { y: 0, rotation: 0, opacity: 1 });
      from(pieces(root, "plan"), { y: -60, rotation: -4, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 0.7 }, 0.08);
      from(pieces(root, "planBig"), { scale: 0.85, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.55 }, 0.3);
      break;
    }
    case "wallet": {
      from(pieces(root, "peek"), { scaleX: 0.4, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.55 }, 0.1);
      from(pieces(root, "wallet"), { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.65 });
      from(pieces(root, "stat"), { y: 16, scale: 0.9, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.5, stagger: 0.07 }, 0.26);
      break;
    }
    case "inbox": {
      from(pieces(root, "msg"), { x: 36, opacity: 0 }, { x: 0, opacity: 1, duration: 0.55, stagger: 0.08 });
      break;
    }
    case "fan": {
      // The platform cards start as one upright stack at the fan's centre and open out into their tilts.
      const cards = pieces(root, "pcard");
      const c = centre(root);
      const at = cards.map((card) => {
        const o = centre(card);
        return { x: c.x - o.x, y: c.y - o.y };
      });
      from(cards, { x: (i) => at[i].x, y: (i) => at[i].y, rotation: () => 0, scale: 0.9, opacity: 0 }, { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, duration: 0.7, stagger: 0.06 });
      break;
    }
    case "phone": {
      from(pieces(root, "phone"), { y: 70, rotation: 3, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 0.7 });
      from(pieces(root, "notif"), { y: -34, scale: 0.96, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.55 }, 0.4);
      break;
    }
    case "creator": {
      // The figure stands up first, then the card lifts in front of it.
      from(Array.from(root.querySelectorAll<HTMLElement>(":scope > svg")), { y: 26, opacity: 0 }, { y: 0, opacity: 1 });
      from(pieces(root, "card"), { y: 40, rotation: -3, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 0.7 }, 0.14);
      break;
    }
  }
  const settle = () => {
    gsap.set(all, { clearProps: CLEAR });
    all.forEach((el) => el.style.removeProperty("transform"));
  };
  tl.eventCallback("onComplete", settle);
  const trigger = root.closest<HTMLElement>("[data-tile], li") ?? root;
  const st = ScrollTrigger.create({ trigger, start: "top 85%", once: true, onEnter: () => void tl.play() });
  if (st.progress >= 1) tl.progress(1);
  return {
    kill: () => {
      st.kill();
      tl.kill();
      settle();
    },
  };
}

/**
 * R1302 /partners section motion. Rendered once per section by the server components (Bento.tsx, Sections.tsx), draws
 * nothing; on mount it finds the section by id and gives it:
 * - entrances for the mockups ([data-anim], see `entrance`), time-based at the token ease, once each;
 * - on fine pointers, a scroll lag: while the section scrolls, each mockup trails the page by a few px in
 *   proportion to the scroll speed and eases back when it stops (tweens toward a target, never a scrub), and a
 *   pointer parallax: the mockup drifts a few px toward the cursor inside its tile. Both share one x/y per mockup.
 * Reduced motion: nothing runs; the CSS end state is the page. Phones and low-power machines get the entrances only.
 */
export function PartnersMotion({ root }: { root: string }) {
  useGSAP(
    () => {
      const el = document.getElementById(root);
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const mocks = Array.from(el.querySelectorAll<HTMLElement>("[data-anim]"));
        const made = mocks.map(entrance);
        const offs: (() => void)[] = [];

        if (window.matchMedia("(pointer: fine)").matches && !simple()) {
          const opts = { duration: 0.6, ease: "power3.out" };
          const drift = mocks.map((m, i) => {
            const d = { k: 0.7 + (i % 3) * 0.25, lag: 0, px: 0, py: 0, x: gsap.quickTo(m, "x", opts), y: gsap.quickTo(m, "y", opts), apply() { d.x(d.px); d.y(d.py + d.lag); } };
            return d;
          });
          const settle = gsap.delayedCall(LAG.settle, () => drift.forEach((d) => ((d.lag = 0), d.apply()))).pause();
          const lag = ScrollTrigger.create({
            trigger: el,
            start: "top bottom",
            end: "bottom top",
            onUpdate: (self) => {
              const v = gsap.utils.clamp(-LAG.cap, LAG.cap, self.getVelocity() / LAG.gain);
              drift.forEach((d) => ((d.lag = v * d.k), d.apply()));
              settle.restart(true);
            },
          });
          offs.push(() => (lag.kill(), settle.kill()));
          el.querySelectorAll<HTMLElement>("[data-tilt]").forEach((tile) => {
            const i = mocks.indexOf(tile.querySelector<HTMLElement>("[data-anim]") as HTMLElement);
            if (i < 0) return;
            const d = drift[i];
            const move = (e: PointerEvent) => {
              const r = tile.getBoundingClientRect();
              d.px = (((e.clientX - r.left) / r.width) * 2 - 1) * DRIFT.x;
              d.py = (((e.clientY - r.top) / r.height) * 2 - 1) * DRIFT.y;
              d.apply();
            };
            const leave = () => ((d.px = 0), (d.py = 0), d.apply());
            tile.addEventListener("pointermove", move, { passive: true });
            tile.addEventListener("pointerleave", leave, { passive: true });
            offs.push(() => (tile.removeEventListener("pointermove", move), tile.removeEventListener("pointerleave", leave)));
          });
          offs.push(() => gsap.set(mocks, { clearProps: CLEAR }));
        }
        return () => {
          made.forEach((m) => m.kill());
          offs.forEach((f) => f());
        };
      });
    },
    { dependencies: [root] },
  );
  return null;
}
