"use client";
import { useEffect } from "react";

/**
 * Two pointer toys for the public pages, wired once with delegated listeners:
 *
 * - [data-bounce]: a link whose BounceText letters squash and spring back each time the
 *   pointer (or keyboard focus) arrives. The bounce always plays to the end instead of
 *   snapping back when the pointer leaves halfway.
 * - [data-flick]: entering the zone knocks its .flick object. Pointer speed sets the push,
 *   where you hit it (relative to its centre) sets the spin, and a damped spring brings it
 *   home. Only transform is written, so CSS entrance animations on scale/rotate/translate
 *   keep working underneath.
 *
 * Mouse only (fine pointer with hover); prefers-reduced-motion switches both off.
 */
type Spring = { x: number; y: number; r: number; vx: number; vy: number; vr: number; t: number; raf: number };

const K = 120; // stiffness: how hard it pulls home
const C = 8; // damping: ~0.35 of critical, so it overshoots once or twice
const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

export function MotionFx() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let px = 0;
    let py = 0;
    let vx = 0; // pointer velocity in px per 60 Hz frame, lightly smoothed
    let vy = 0;
    let last = 0;
    const springs = new WeakMap<HTMLElement, Spring>();

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const dt = Math.max(4, Math.min(100, e.timeStamp - last || 16.7));
      const f = 16.7 / dt;
      vx = vx * 0.4 + (e.clientX - px) * f * 0.6;
      vy = vy * 0.4 + (e.clientY - py) * f * 0.6;
      px = e.clientX;
      py = e.clientY;
      last = e.timeStamp;
    };

    const bounce = (root: HTMLElement) => {
      if (root.hasAttribute("data-bouncing")) return;
      const chars = root.querySelectorAll<HTMLElement>(".bt-c");
      if (!chars.length) return;
      root.setAttribute("data-bouncing", "");
      const done = () => root.removeAttribute("data-bouncing");
      chars[chars.length - 1].addEventListener("animationend", done, { once: true });
      window.setTimeout(done, 1600); // in case the animation never ran (tab hidden, styles missing)
    };

    const step = (el: HTMLElement, s: Spring) => (now: number) => {
      const dt = Math.min(1 / 30, (now - s.t) / 1000 || 1 / 60);
      s.t = now;
      s.vx += (-K * s.x - C * s.vx) * dt;
      s.vy += (-K * s.y - C * s.vy) * dt;
      s.vr += (-K * s.r - C * s.vr) * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.r += s.vr * dt;
      const still = Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.r) < 0.05 && Math.abs(s.vx) + Math.abs(s.vy) + Math.abs(s.vr) < 0.5;
      if (still) {
        el.style.removeProperty("transform");
        springs.delete(el);
        return;
      }
      el.style.transform = `translate3d(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px, 0) rotate(${s.r.toFixed(2)}deg)`;
      s.raf = requestAnimationFrame(step(el, s));
    };

    const flick = (zone: HTMLElement, e: PointerEvent) => {
      if (!fine.matches) return;
      const targets = zone.matches(".flick") ? [zone] : Array.from(zone.querySelectorAll<HTMLElement>(".flick"));
      for (const el of targets) {
        const b = el.getBoundingClientRect();
        const ox = e.clientX - (b.left + b.width / 2);
        const oy = e.clientY - (b.top + b.height / 2);
        const lever = Math.hypot(ox, oy) || 1;
        const torque = (ox * vy - oy * vx) / lever; // px/frame of tangential speed
        let s = springs.get(el);
        if (!s) {
          s = { x: 0, y: 0, r: 0, vx: 0, vy: 0, vr: 0, t: performance.now(), raf: 0 };
          springs.set(el, s);
          s.raf = requestAnimationFrame(step(el, s));
        }
        s.vx = clamp(s.vx + vx * 18, 620);
        s.vy = clamp(s.vy + vy * 18, 620);
        s.vr = clamp(s.vr + torque * 16, 240);
      }
    };

    const entering = (zone: Element, e: PointerEvent) => !(e.relatedTarget instanceof Node && zone.contains(e.relatedTarget));

    const onOver = (e: PointerEvent) => {
      if (reduce.matches || e.pointerType !== "mouse") return;
      const t = e.target as Element | null;
      if (!t?.closest) return;
      const b = t.closest<HTMLElement>("[data-bounce]");
      if (b && entering(b, e)) bounce(b);
      const z = t.closest<HTMLElement>("[data-flick]");
      if (z && entering(z, e)) flick(z, e);
    };

    const onFocus = (e: FocusEvent) => {
      if (reduce.matches) return;
      const t = e.target as Element | null;
      const b = t?.closest?.<HTMLElement>("[data-bounce]");
      if (b && b.matches(":focus-visible")) bounce(b);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("focusin", onFocus);
    };
  }, []);

  return null;
}
