"use client";
import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MOTION_OK } from "@/lib/motion/gsap";

gsap.registerPlugin(ScrollTrigger);

/**
 * GSAP scroll scenes for every landing section, mounted once at the end of the page.
 *
 * Every scene is scrubbed (tied to the scroll position, so it plays backwards too) and only writes
 * transform, plus opacity on the hero as it leaves. Nothing starts hidden: an element that never gets
 * its scene still reads fine, so content is never lost to a slow script.
 *
 * Hands off what already moves:
 * - [data-reveal] wrappers and the children of [data-stagger] (the CSS entrance in Reveal.tsx)
 * - .flick / .pop-in / .hf-in (MotionFx springs and CSS entrance animations)
 * GSAP animates a parent or a child of those instead, so the transforms stack instead of fighting.
 *
 * Reduced motion: none of it runs (gsap.matchMedia on MOTION_OK). Phones get shorter travel
 * and no sideways offsets; the multi-column parallax only makes sense on wide grids.
 */
const BUSY = "[data-reveal],.flick,.pop-in,.hf-in";

type El = HTMLElement | SVGElement;
function safe(list: Element[]): El[] {
  return list.filter((el): el is El => (el instanceof HTMLElement || el instanceof SVGElement) && !el.matches(BUSY) && !el.parentElement?.matches("[data-stagger]"));
}
const all = (root: ParentNode, sel: string) => safe(Array.from(root.querySelectorAll(sel)));
const one = (root: ParentNode, sel: string) => all(root, sel).slice(0, 1);

export function ScrollScenes() {
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const mm = gsap.matchMedia();

    // Built when the main thread is free (or within 700ms), so it does not lengthen the hydration task.
    // The hero scene starts at rest and every other scene only sets its start offset below the fold, so nothing on screen jumps.
    const build = () => mm.add({ motion: MOTION_OK, wide: "(min-width: 768px)", lg: "(min-width: 1024px)" }, (ctx) => {
      const { motion, wide, lg } = ctx.conditions as { motion: boolean; wide: boolean; lg: boolean };
      if (!motion) return;
      const k = wide ? 1 : 0.55; // travel scale on phones
      const scrub = wide ? 0.6 : true;
      /** One scrubbed tween from `from` to rest, over the section's entry into view. */
      const enter = (targets: El[], trigger: Element, from: gsap.TweenVars, range: [string, string] = ["top 95%", "top 45%"], stagger = 0) => {
        if (!targets.length) return;
        gsap.fromTo(targets, from, {
          x: 0, y: 0, scale: 1, rotate: 0, ease: "none", stagger,
          scrollTrigger: { trigger, start: range[0], end: range[1], scrub },
        });
      };
      const sections = Array.from(main.querySelectorAll<HTMLElement>(":scope > section, :scope > div > section"));

      // 1. Every section heading drifts in a little behind its section, for a layer of depth.
      for (const s of sections) {
        if (s.matches("[aria-labelledby=hero-title]")) continue;
        enter(all(s, "h2"), s, { y: 56 * k }, ["top 98%", "top 35%"]);
      }

      // 2. Hero: as you scroll past, the copy lifts away faster than the card fan, and the glow sinks.
      const hero = main.querySelector<HTMLElement>("section[aria-labelledby=hero-title]");
      if (hero) {
        const tl = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub } });
        const copy = one(hero, ":scope > div.relative.flex");
        const fan = one(hero, ":scope > div.relative:not(.flex)");
        const glow = one(hero, ":scope > .hf-glow");
        if (copy.length) tl.to(copy, { y: -110 * k, opacity: 0.35 }, 0);
        if (fan.length) tl.to(fan, { y: -40 * k, scale: 0.97 }, 0);
        if (glow.length) tl.to(glow, { y: 140 * k }, 0);
        // The hand of cards deals itself out as you leave: the outer cards swing wider and drop, the centre one rises.
        // CSS variables feed the slots' own translate/rotate properties (globals.css), so the CSS entrance on transform is untouched.
        const slots = Array.from(hero.querySelectorAll<HTMLElement>(".hf-slot"));
        const mid = (slots.length - 1) / 2;
        slots.forEach((s, i) => {
          const o = i - mid;
          tl.fromTo(
            s,
            { "--fx": "0px", "--fy": "0px", "--fr": "0deg" },
            { "--fx": `${o * 46 * k}px`, "--fy": `${o ? Math.abs(o) * 18 * k : -22 * k}px`, "--fr": `${o * 5}deg` },
            0,
          );
        });
      }

      // 3. "Publishes to" ticker eases up to full size.
      const lt = main.querySelector("section.lt");
      if (lt) enter(one(lt, ".lt-viewport"), lt, { y: 28 * k, scale: 0.96 });

      // 4. The dotted route line draws itself across.
      for (const r of all(main, "[data-route]")) {
        const svg = one(r, "svg");
        if (svg.length) gsap.fromTo(svg, { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, ease: "none", scrollTrigger: { trigger: r, start: "top 92%", end: "top 55%", scrub } });
      }

      // 5. How it works: the board rises and the three steps arrive one after another.
      const how = main.querySelector("#how");
      if (how) {
        enter(one(how, "ol"), how, { y: 70 * k, scale: 0.96 });
        if (wide) enter(all(how, "ol > li"), how, { y: 90 }, ["top 90%", "top 30%"], 0.12);
      }

      // 6. Features: columns settle at different speeds (column 1 first), so the grid feels deep.
      const features = main.querySelector("#features");
      if (features) {
        const grid = one(features, ".grid");
        enter(grid, features, { y: 60 * k });
        if (wide && grid[0]) {
          const cards = all(grid[0], "article");
          cards.forEach((c, i) => {
            const col = i === 0 ? 0 : (i + 1) % 3; // the lead card spans two columns
            if (col) enter([c], c, { y: 34 * col }, ["top 100%", "top 55%"]);
          });
        }
      }

      // 7. Demo: the whole player scales up into place like a screen coming forward.
      const demo = main.querySelector("#demo");
      if (demo) enter(one(demo, ":scope > div"), demo, { y: 80 * k, scale: 0.92 }, ["top 95%", "top 25%"]);

      // 8. Why Outlly: each point slides in from the right, one after another. Only beside the copy (lg): when the list
      //    is full width (tablet) a sideways start would push past the screen edge and make the page scroll sideways.
      const why = main.querySelector("#why");
      if (why) enter(all(why, "ul.divide-y > li"), why, lg ? { x: 70 } : { y: 30 }, ["top 85%", "top 25%"], 0.08);

      // 9. Platforms: the bento columns move at different speeds, the middle one furthest.
      //    Phones stack them, so each column then follows its own position instead of the section's.
      const platforms = main.querySelector("#platforms");
      if (platforms) {
        const cols = all(platforms, ".bx > .bx-col");
        cols.forEach((c, i) => (wide ? enter([c], platforms, { y: i % 2 ? 110 : 40 }, ["top 90%", "top 30%"]) : enter([c], c, { y: 36 }, ["top 100%", "top 60%"])));
      }

      // 10. Comparison: the table rises (no scale: its header row is sticky and should stay crisp).
      const compare = main.querySelector("#compare");
      if (compare) enter(all(compare, ":scope > div > [data-reveal]:not(.rv-head):not([data-stagger]) > *").slice(0, 1), compare, { y: 70 * k }, ["top 90%", "top 25%"]);

      // 11. Pricing: the middle plan leads, the outer two follow it up.
      const pricing = main.querySelector("#pricing");
      if (pricing) {
        const cards = all(pricing, "[data-stagger] > li > *");
        cards.forEach((c, i) => (wide ? enter([c], pricing, { y: i === 1 ? 30 : 80 }, ["top 85%", "top 25%"]) : enter([c], c, { y: 30 }, ["top 100%", "top 65%"])));
      }

      // 12. FAQ: the answers column rises a beat after the question side.
      const faq = main.querySelector("#faq");
      if (faq) {
        enter(one(faq, ":scope > div > div"), faq, { y: 40 * k });
        enter(all(faq, ":scope > div > [data-reveal]:not(.rv-head) > *").slice(0, 1), faq, { y: 80 * k }, ["top 90%", "top 30%"]);
      }

      // 13. Final call to action: the card swells to full size and the side walls close in on the phone.
      const cta = main.querySelector("section[aria-labelledby=cta-title]");
      if (cta) {
        enter(all(cta, ".ap-canvas"), cta, { y: 60 * k, scale: 0.92 }, ["top 95%", "top 35%"]);
        const stage = cta.querySelector(".fc-stage");
        if (stage) {
          const [l, phone, r] = safe(Array.from(stage.children));
          if (wide && l && r) {
            enter([l], stage, { x: -90, y: 40 }, ["top 100%", "top 40%"]);
            enter([r], stage, { x: 90, y: 40 }, ["top 100%", "top 40%"]);
          }
          if (phone) enter([phone], stage, { y: 90 * k }, ["top 100%", "top 40%"]);
        }
      }

      // Accordions, images and fonts change the page height after load: re-measure, at most once a frame.
      let raf = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => ScrollTrigger.refresh());
      });
      ro.observe(main);
      return () => {
        ro.disconnect();
        cancelAnimationFrame(raf);
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
