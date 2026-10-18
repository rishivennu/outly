"use client";
import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Landing-only motion layer (10-18b), on top of ScrollScenes. One pointer listener and one rAF loop drive it all,
 * and the loop stops as soon as everything has settled.
 *
 * - Off-screen pause: each section (and the footer) further than half a screen from view gets data-off, and CSS
 *   pauses every animation inside it, so the page's ~140 looping animations only run where they can be seen.
 * - Magnetic CTAs [data-magnet]: the button leans toward the pointer (10px at most) and glides home on leave.
 *   It writes the CSS `translate` property, so the buttons' own hover lift and press scale (transform) still work.
 * - Spotlight cards [data-spot]: a soft light and a lit rim follow the pointer across the card (globals.css).
 * - Hero aura: a lime glow trails the pointer behind the headline (lerped, transform only).
 * - Ticker: scroll speed pushes the "Publishes to" row along faster (backwards when you scroll up) and leans the logos.
 *
 * Pointer effects are mouse only (hover + fine pointer). Reduced motion turns off everything except the pause.
 */
const MAG_X = 0.22;
const MAG_Y = 0.32;
const MAG_MAX = 10;
const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

type Mag = { el: HTMLElement; x: number; y: number; tx: number; ty: number };

export function LandingFx() {
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const off: (() => void)[] = [];

    // 1. Pause what is off screen.
    // Top-level sections wherever the page wrapper puts them (main holds one transition div), plus the footer.
    const zones = [...Array.from(main.querySelectorAll<HTMLElement>("section")).filter((s) => !s.parentElement?.closest("section")), ...Array.from(document.querySelectorAll<HTMLElement>("body footer"))];
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) (e.target as HTMLElement).toggleAttribute("data-off", !e.isIntersecting);
        },
        { rootMargin: "50% 0px 50% 0px" },
      );
      zones.forEach((z) => io.observe(z));
      off.push(() => {
        io.disconnect();
        zones.forEach((z) => z.removeAttribute("data-off"));
      });
    }

    // 2-4. Pointer toys, one rAF loop.
    const hero = main.querySelector<HTMLElement>("section[aria-labelledby=hero-title]");
    const aura = hero?.querySelector<HTMLElement>(".hf-aura") ?? null;
    const mags = new Map<HTMLElement, Mag>();
    const au = { x: 0, y: 0, tx: 0, ty: 0, on: false, placed: false };
    let px = -1;
    let py = -1;
    let over: Element | null = null;
    let frame = 0;

    const tick = () => {
      frame = 0;
      let busy = false;

      // magnet: aim the hovered button at the pointer, everything else home
      const hot = over?.closest?.<HTMLElement>("[data-magnet]") ?? null;
      if (hot && !mags.has(hot)) mags.set(hot, { el: hot, x: 0, y: 0, tx: 0, ty: 0 });
      for (const m of mags.values()) {
        if (m.el === hot) {
          const b = m.el.getBoundingClientRect();
          m.tx = clamp((px - (b.left + b.width / 2)) * MAG_X, MAG_MAX);
          m.ty = clamp((py - (b.top + b.height / 2)) * MAG_Y, MAG_MAX * 0.8);
        } else {
          m.tx = 0;
          m.ty = 0;
        }
        m.x += (m.tx - m.x) * 0.2;
        m.y += (m.ty - m.y) * 0.2;
        if (Math.abs(m.tx - m.x) + Math.abs(m.ty - m.y) < 0.05 && m.tx === 0 && m.ty === 0) {
          m.el.style.removeProperty("translate");
          mags.delete(m.el);
        } else {
          m.el.style.translate = `${m.x.toFixed(2)}px ${m.y.toFixed(2)}px`;
          busy = true;
        }
      }

      // spotlight: light follows the pointer on the hovered card
      const card = over?.closest?.<HTMLElement>("[data-spot]");
      if (card) {
        const b = card.getBoundingClientRect();
        card.style.setProperty("--sx", `${(px - b.left).toFixed(1)}px`);
        card.style.setProperty("--sy", `${(py - b.top).toFixed(1)}px`);
      }

      // hero aura: trails the pointer while it is over the hero
      if (aura && hero) {
        const inside = !!over && hero.contains(over);
        if (inside) {
          const b = hero.getBoundingClientRect();
          au.tx = px - b.left;
          au.ty = py - b.top;
          if (!au.placed) {
            au.x = au.tx;
            au.y = au.ty;
            au.placed = true;
          }
        }
        if (inside !== au.on) {
          au.on = inside;
          aura.toggleAttribute("data-on", inside);
        }
        const dx = au.tx - au.x;
        const dy = au.ty - au.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.3) {
          au.x += dx * 0.09;
          au.y += dy * 0.09;
          aura.style.transform = `translate3d(${au.x.toFixed(1)}px, ${au.y.toFixed(1)}px, 0)`;
          busy = true;
        }
      }

      if (busy) frame = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !fine.matches || reduce.matches) return;
      px = e.clientX;
      py = e.clientY;
      over = e.target instanceof Element ? e.target : null;
      kick();
    };
    const onLeave = () => {
      over = null;
      kick();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    off.push(() => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame);
      for (const m of mags.values()) m.el.style.removeProperty("translate");
      aura?.removeAttribute("data-on");
    });

    // 5. Ticker follows scroll speed.
    const track = main.querySelector<HTMLElement>(".lt-track");
    const anim = track?.getAnimations?.()[0];
    if (track && anim && !reduce.matches) {
      // Start deep inside the loop so playing backwards for a while never runs into the start and finishes it.
      const t0 = Number(anim.currentTime ?? 0);
      anim.currentTime = t0 + 38000 * 60;
      const st = { r: 1, sk: 0 };
      const apply = () => {
        anim.playbackRate = st.r;
        track.style.setProperty("--lt-sk", `${st.sk.toFixed(2)}deg`);
      };
      const trig = ScrollTrigger.create({
        trigger: main,
        start: 0,
        end: "max",
        onUpdate: (self) => {
          const v = self.getVelocity(); // px per second, negative going up
          if (Math.abs(v) < 40) return;
          gsap.to(st, {
            r: Math.max(-5, Math.min(7, 1 + v / 280)),
            sk: clamp(-v / 260, 7),
            duration: 0.25,
            ease: "power2.out",
            overwrite: true,
            onUpdate: apply,
            onComplete: () => {
              gsap.to(st, { r: 1, sk: 0, duration: 1.1, ease: "power3.out", onUpdate: apply });
            },
          });
        },
      });
      off.push(() => {
        trig.kill();
        gsap.killTweensOf(st);
        anim.playbackRate = 1;
        track.style.removeProperty("--lt-sk");
      });
    }

    return () => off.forEach((f) => f());
  }, []);

  return null;
}
