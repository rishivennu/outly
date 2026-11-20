"use client";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { gsapNow, loadGsap } from "./gsap-lazy";
import { reduced } from "./prefs";
import { FADE, FLUID_EASE, PILL, PRESS, pillBox, pressScale, type PanelVariant } from "./fluid";

const REST = { x: 0, y: 0, xPercent: 0, yPercent: 0, scale: 1, opacity: 1 };

/**
 * R1255: open / close motion for a panel that mounts itself (no Radix Presence): returns whether to render it. Opening
 * mounts it and tweens it in from the variant's offset; closing makes it inert at once (no clicks, out of the tab
 * order, so the page under it is usable straight away), tweens it out in half the time and only then unmounts it.
 * Every tween starts from where the panel is now, so reopening mid-close turns it round instead of restarting.
 * Reduced motion: a short fade. Before GSAP has loaded (it loads on idle) the panel simply shows and hides.
 */
export function usePanelPresence(open: boolean, ref: RefObject<HTMLElement | null>, variant: PanelVariant, origin = "50% 0%") {
  const [mounted, setMounted] = useState(open);
  const live = useRef(false);
  const node = useRef<HTMLElement | null>(null);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    loadGsap().catch(() => {});
    return () => void (node.current && gsapNow()?.killTweensOf(node.current));
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    node.current = el;
    if (!el) {
      live.current = false;
      return;
    }
    const g = gsapNow();
    const still = reduced();
    if (open) {
      el.inert = false;
      if (!g) return void (live.current = true);
      if (!live.current) g.set(el, still ? { opacity: 0 } : { ...variant.from, opacity: 0, transformOrigin: origin });
      live.current = true;
      g.to(el, {
        ...(still ? { opacity: 1 } : REST),
        duration: still ? FADE.enter : variant.enter,
        ease: FLUID_EASE.gsapEnter,
        overwrite: true,
        onComplete: () => void g.set(el, { clearProps: "transform,opacity" }),
      });
      return;
    }
    if (!mounted) return;
    el.inert = true;
    const done = () => {
      live.current = false;
      setMounted(false);
    };
    if (!g) return done();
    g.to(el, {
      ...(still ? {} : { ...variant.from, transformOrigin: origin }),
      opacity: 0,
      duration: still ? FADE.exit : variant.exit,
      ease: FLUID_EASE.gsapExit,
      overwrite: true,
      onComplete: done,
    });
  }, [open, mounted]); // eslint-disable-line react-hooks/exhaustive-deps
  return mounted;
}

/**
 * R1255: one highlight for a whole navigation surface. A single pill (`pill`, absolutely placed inside `host`) glides
 * to the item under the mouse or the keyboard focus, so moving down a list reads as one surface filling, not rows
 * switching on and off. It appears in place, follows on expo.out, and retracts when the pointer leaves or lands on
 * a control that is not a nav item. `clip` is a scrolling list inside the host: the pill is cut to what shows of it.
 * Mouse and keyboard only (touch has no hover), and never under reduced motion, where the CSS hover stays as it was.
 * The host gets data-hpill once the pill is live, which is what turns the items' own hover fill off (globals.css).
 */
export function useHoverPill(host: RefObject<HTMLElement | null>, pill: RefObject<HTMLElement | null>, o: { items: string; clip?: string }) {
  useEffect(() => {
    const root = host.current;
    const p = pill.current;
    if (!root || !p || reduced() || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let off = false;
    let stop = () => {};
    loadGsap()
      .then((g) => {
        if (off) return;
        let cur: HTMLElement | null = null;
        const itemOf = (t: EventTarget | null) => {
          const el = (t as Element | null)?.closest?.<HTMLElement>(o.items);
          return el && root.contains(el) ? el : null;
        };
        const box = (el: HTMLElement) => {
          const clip = o.clip ? el.closest<HTMLElement>(o.clip) : null;
          return pillBox(el.getBoundingClientRect(), root.getBoundingClientRect(), { left: root.clientLeft, top: root.clientTop }, clip?.getBoundingClientRect());
        };
        const to = (el: HTMLElement | null) => {
          cur = el;
          const b = el && box(el);
          if (!b) {
            cur = null;
            g.to(p, { opacity: 0, scale: PILL.from, duration: PILL.exit, ease: FLUID_EASE.gsapExit, overwrite: "auto" });
            return;
          }
          const at = { x: b.x, y: b.y, width: b.w, height: b.h };
          if (Number(g.getProperty(p, "opacity")) > 0.01) {
            g.to(p, { ...at, opacity: 1, scale: 1, duration: PILL.move, ease: FLUID_EASE.gsapEnter, overwrite: "auto" });
          } else {
            g.set(p, { ...at, scale: PILL.from, overwrite: true });
            g.to(p, { opacity: 1, scale: 1, duration: PILL.enter, ease: FLUID_EASE.gsapEnter, overwrite: "auto" });
          }
        };
        const focused = () => {
          const a = document.activeElement;
          return a instanceof HTMLElement && a.matches(":focus-visible") ? itemOf(a) : null;
        };
        const over = (e: PointerEvent) => {
          if (e.pointerType !== "mouse") return;
          const el = itemOf(e.target);
          if (el) {
            if (el !== cur) to(el);
          } else if ((e.target as Element | null)?.closest?.("a, button, input, [role='button'], [role='radiogroup']")) {
            if (cur) to(null);
          }
        };
        const leave = (e: PointerEvent) => e.pointerType === "mouse" && to(focused());
        const focusIn = (e: FocusEvent) => {
          const el = itemOf(e.target);
          if (el && el.matches(":focus-visible")) to(el);
        };
        const focusOut = (e: FocusEvent) => {
          if (!root.contains(e.relatedTarget as Node | null) && !root.matches(":hover")) to(null);
        };
        // the rail widening, or its list scrolling, moves the item: the pill stays on it (no tween, it is already there)
        const follow = () => {
          if (!cur) return;
          const b = box(cur);
          if (b) g.set(p, { x: b.x, y: b.y, width: b.w, height: b.h });
          else to(null);
        };
        const ro = new ResizeObserver(follow);
        ro.observe(root);
        root.addEventListener("pointerover", over);
        root.addEventListener("pointerleave", leave);
        root.addEventListener("focusin", focusIn);
        root.addEventListener("focusout", focusOut);
        root.addEventListener("scroll", follow, true);
        root.setAttribute("data-hpill", "");
        stop = () => {
          ro.disconnect();
          root.removeEventListener("pointerover", over);
          root.removeEventListener("pointerleave", leave);
          root.removeEventListener("focusin", focusIn);
          root.removeEventListener("focusout", focusOut);
          root.removeEventListener("scroll", follow, true);
          root.removeAttribute("data-hpill");
          g.killTweensOf(p);
          g.set(p, { clearProps: "all" });
        };
      })
      .catch(() => {});
    return () => {
      off = true;
      stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

const PRESSABLE = 'button, [role="button"], [role="tab"], [role="radio"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [aria-pressed], a[data-press]';
/** Controls with a press of their own: Button (btn-lift), the rail, the phone bars, switches. */
const OWN = '.btn-lift, .rail-row, .mtab, .mtop-btn, [role="switch"], [data-no-press]';
/** The phone's liquid glass buttons press themselves under 1024px (globals.css .gbtn*). */
const OWN_PHONE = ".gbtn, .gbtn-icon, .gchip, .gseg > *";
const OFF = ':disabled, [aria-disabled="true"], [data-disabled]';

/**
 * R1255: the press for every other control (icon buttons, segmented controls, chips, tabs, options), from one
 * delegated listener: a quick squeeze to about 97% and a slower settle back on release, tweened on a CSS variable
 * (globals.css [data-pressing] { scale: var(--press) }), so it composes with whatever transform the control already
 * has and never touches its own transitions. Disabled controls and controls that already press are left alone.
 * Mount once per app shell. Reduced motion: no press.
 */
export function usePressFx() {
  useEffect(() => {
    if (reduced()) return;
    const phone = matchMedia("(max-width: 1023.98px)");
    let held: HTMLElement | null = null;
    const release = () => {
      const el = held;
      held = null;
      const g = gsapNow();
      if (!el || !g) return;
      g.to(el, {
        "--press": 1,
        duration: PRESS.up,
        ease: FLUID_EASE.gsapEnter,
        overwrite: "auto",
        onComplete: () => {
          if (held === el) return;
          el.removeAttribute("data-pressing");
          el.style.removeProperty("--press");
        },
      });
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const g = gsapNow();
      if (!g) return void loadGsap().catch(() => {});
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(PRESSABLE);
      if (!el || el.matches(OFF) || el.closest(OWN) || (phone.matches && el.matches(OWN_PHONE))) return;
      if (typeof el.className === "string" && /(^|\s)active:(scale|translate)/.test(el.className)) return;
      const r = el.getBoundingClientRect();
      const s = pressScale(r.width, r.height);
      if (s === null) return;
      if (held) release();
      held = el;
      if (!el.hasAttribute("data-pressing")) {
        el.style.setProperty("--press", "1");
        el.setAttribute("data-pressing", "");
      }
      g.to(el, { "--press": s, duration: PRESS.down, ease: FLUID_EASE.gsapEnter, overwrite: "auto" });
    };
    document.addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("pointerup", release, { passive: true });
    document.addEventListener("pointercancel", release, { passive: true });
    document.addEventListener("dragstart", release);
    window.addEventListener("blur", release);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
      document.removeEventListener("dragstart", release);
      window.removeEventListener("blur", release);
      release();
    };
  }, []);
}
