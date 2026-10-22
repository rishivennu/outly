"use client";
import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MOTION_OK } from "@/lib/motion/gsap";
import { rowsIn } from "@/lib/motion/reveal";
import { whenLenis } from "./SmoothScroll";

gsap.registerPlugin(ScrollTrigger);

/**
 * Landing scenes (10-22 cinematic pass), mounted once at the end of the page.
 *
 * Entrances belong to the one reveal engine (lib/motion/reveal.ts, via <Reveal>). This file only adds the
 * moments that need the scroll position itself:
 *   1. Hero leave: copy lifts away, the glow sinks, the hand of cards deals itself out.
 *   2. Route line draws itself across.
 *   3. How it works (lg): the section pins and the three steps light up in turn as the rail fills.
 *   4. Demo (lg): the section pins and scrolling walks through the four beats; past it, the clock takes over.
 *   5. Comparison: opening a group (or Expand all) brings its rows in, in threes; opening a row deals its cards.
 *   6. Final call to action: the side walls close in on the phone and the tiles settle, once.
 *
 * Pins only happen when the section fits the window, so nothing is ever cut off. Reduced motion: none of it
 * runs (gsap.matchMedia on MOTION_OK); every section is then just its plain, readable layout.
 * Transforms and opacity only; no layout properties are animated.
 */
const EASE = "expo.out";

export function ScrollScenes() {
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const mm = gsap.matchMedia();

    // Built when the main thread is free (or within 700ms), so it does not lengthen the hydration task.
    const build = () => mm.add({ motion: MOTION_OK, wide: "(min-width: 768px)", lg: "(min-width: 1024px)" }, (ctx) => {
      const { motion, wide, lg } = ctx.conditions as { motion: boolean; wide: boolean; lg: boolean };
      if (!motion) return;
      const k = wide ? 1 : 0.55; // travel scale on phones
      const scrub = wide ? 0.6 : true;
      const fits = (el: HTMLElement) => el.offsetHeight <= innerHeight - 96; // leave room for the floating nav
      // Teardown for the non-GSAP side effects below (inline styles, attributes, listeners, events). Runs when this
      // media set reverts. (ctx.add(fn) would run fn right away, not on revert.)
      const undo: Array<() => void> = [];

      // 1. Hero leave.
      const hero = main.querySelector<HTMLElement>("section[aria-labelledby=hero-title]");
      if (hero) {
        const tl = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub } });
        const copy = hero.querySelector(":scope > div.relative.flex");
        const fan = hero.querySelector(":scope > div.relative:not(.flex)");
        const glow = hero.querySelector(":scope > .hf-glow");
        if (copy) tl.to(copy, { y: -110 * k, opacity: 0.35 }, 0);
        if (fan) tl.to(fan, { y: -40 * k, scale: 0.97 }, 0);
        if (glow) tl.to(glow, { y: 140 * k }, 0);
        // One progress value drives each card slot's own translate/rotate (plain properties, so the CSS entrance on
        // transform is untouched and no inherited variable restyles the cards' children).
        const slots = Array.from(hero.querySelectorAll<HTMLElement>(".hf-slot"));
        const mid = (slots.length - 1) / 2;
        const deal = { p: 0 };
        let lastP = -1;
        const dealOut = () => {
          const p = Math.round(deal.p * 400) / 400;
          if (p === lastP) return;
          lastP = p;
          slots.forEach((s, i) => {
            const o = i - mid;
            s.style.translate = p ? `${(o * 46 * k * p).toFixed(1)}px ${((o ? Math.abs(o) * 18 : -22) * k * p).toFixed(1)}px` : "";
            s.style.rotate = p ? `${(o * 5 * p).toFixed(2)}deg` : "";
          });
        };
        tl.fromTo(deal, { p: 0 }, { p: 1, onUpdate: dealOut }, 0);
        undo.push(() => slots.forEach((s) => { s.style.translate = ""; s.style.rotate = ""; }));
      }

      // 2. Route line.
      for (const r of Array.from(main.querySelectorAll("[data-route] svg"))) {
        gsap.fromTo(r, { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, ease: "none", scrollTrigger: { trigger: r, start: "top 92%", end: "top 55%", scrub } });
      }

      // 3. How it works: pinned sequence.
      const how = main.querySelector<HTMLElement>("#how");
      const steps = how ? Array.from(how.querySelectorAll<HTMLElement>(".how-step")) : [];
      const fill = how?.querySelector<HTMLElement>(".how-fill");
      const nodes = how ? Array.from(how.querySelectorAll<HTMLElement>(".how-node")) : [];
      // Pin the inner container, not the section: the section's own padding (~190px) would push a 900px screen over the fit limit.
      const howBox = how?.firstElementChild instanceof HTMLElement ? how.firstElementChild : how;
      if (lg && how && howBox && fill && steps.length === 3 && fits(howBox)) {
        const light = (n: number) => {
          nodes.forEach((d, i) => d.toggleAttribute("data-on", i <= n));
          steps.forEach((s, i) => s.toggleAttribute("data-on", i <= n));
        };
        const rail = fill.parentElement;
        rail?.setAttribute("data-live", "");
        // Dim a waiting step's contents, not the li: the li is opaque over the grid's hairline background.
        const parts = (li: HTMLElement) => Array.from(li.querySelectorAll<HTMLElement>(":scope > div > *"));
        const [p2, p3] = [parts(steps[1]), parts(steps[2])];
        gsap.set([...p2, ...p3], { opacity: 0.3 });
        gsap.set(fill, { scaleX: 1 / 3, transformOrigin: "0% 50%" });
        light(0);
        let at = 0;
        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: howBox,
            start: "center center",
            end: () => `+=${Math.round(innerHeight * 1.3)}`,
            pin: true,
            scrub: 0.5,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            onUpdate: (st) => {
              const n = Math.min(2, Math.floor(st.progress * 2.4 + 0.25));
              if (n !== at) light((at = n));
            },
          },
        });
        tl.to(fill, { scaleX: 2 / 3, duration: 1 }, 0)
          .fromTo(p2, { opacity: 0.3, y: 14 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.04 }, 0.5)
          .to(fill, { scaleX: 1, duration: 1 }, 1)
          .fromTo(p3, { opacity: 0.3, y: 14 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.04 }, 1.5)
          .to({}, { duration: 0.4 }); // a short hold on the finished row before the page moves on
        undo.push(() => {
          rail?.removeAttribute("data-live");
          nodes.forEach((d) => d.removeAttribute("data-on"));
          steps.forEach((s) => s.removeAttribute("data-on"));
        });
      }

      // 4. Demo: scroll walks the four beats.
      const demo = main.querySelector<HTMLElement>("#demo");
      const stage = demo?.querySelector<HTMLElement>(".demo-stage");
      if (lg && demo && stage) {
        let beat = -1;
        let active = false;
        const send = () => stage.dispatchEvent(new CustomEvent("demo:scrub", { detail: { beat: Math.max(0, beat), active } }));
        const pin = fits(demo);
        ScrollTrigger.create({
          trigger: demo,
          start: pin ? "center center" : "top 55%",
          end: pin ? () => `+=${Math.round(innerHeight * 1.6)}` : "bottom 45%",
          pin,
          anticipatePin: pin ? 1 : 0,
          invalidateOnRefresh: true,
          onToggle: (st) => {
            active = st.isActive;
            send();
          },
          onUpdate: (st) => {
            const b = Math.min(3, Math.floor(st.progress * 4));
            if (b !== beat) {
              beat = b;
              if (active) send();
            }
          },
        });
        undo.push(() => {
          active = false;
          send();
        });
      }

      // 5. Comparison: groups and rows opened by the visitor.
      const cmp = main.querySelector<HTMLElement>("[data-cmp]");
      if (cmp) {
        const onToggle = (e: Event) => {
          const d = e.target;
          if (!(d instanceof HTMLDetailsElement) || !d.open) return;
          if (d.matches("[data-cmp-group]")) rowsIn(d);
          else {
            const notes = Array.from(d.querySelectorAll<HTMLElement>(".cmp-note"));
            if (notes.length) gsap.fromTo(notes, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.7, ease: EASE, stagger: 0.05, clearProps: "opacity,transform" });
          }
        };
        cmp.addEventListener("toggle", onToggle, true); // toggle does not bubble; capture still sees it
        undo.push(() => cmp.removeEventListener("toggle", onToggle, true));
      }

      // 6. Final call to action.
      const fc = main.querySelector<HTMLElement>("section[aria-labelledby=cta-title] .fc-stage");
      if (fc) {
        const [l, phone, r] = Array.from(fc.children) as HTMLElement[];
        const tiles = Array.from(fc.querySelectorAll<HTMLElement>(".fc-tile"));
        const tl = gsap.timeline({ paused: true, defaults: { ease: EASE, duration: 1.25, clearProps: "opacity,transform" } });
        if (wide && l && r) {
          tl.fromTo(l, { x: -90 }, { x: 0 }, 0).fromTo(r, { x: 90 }, { x: 0 }, 0);
        }
        if (phone) tl.fromTo(phone, { y: 110 * k }, { y: 0, duration: 1.35 }, 0.05);
        if (tiles.length) tl.fromTo(tiles, { opacity: 0, y: 44 }, { opacity: 1, y: 0, duration: 1.05, stagger: { each: 0.05, from: "edges" } }, 0.12);
        ScrollTrigger.create({ trigger: fc, start: "top 88%", once: true, onEnter: () => tl.play() });
      }

      // Accordions, images and fonts change the page height after load: re-measure, at most once a frame.
      let raf = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => ScrollTrigger.refresh());
      });
      ro.observe(main);

      // Smooth scroll moves the page from its own frame loop: update the triggers right there, once.
      let unhook = () => {};
      const stopWaiting = whenLenis((l) => {
        unhook = l.on("scroll", ScrollTrigger.update);
      });
      return () => {
        undo.forEach((f) => f());
        ro.disconnect();
        cancelAnimationFrame(raf);
        stopWaiting();
        unhook();
      };
    });

    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const id = w.requestIdleCallback ? w.requestIdleCallback(build, { timeout: 700 }) : window.setTimeout(build, 1);
    return () => {
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else window.clearTimeout(id);
      mm.revert();
    };
  }, []);
  return null;
}
