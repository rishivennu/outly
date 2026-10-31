"use client";
import { useEffect } from "react";

/**
 * Custom cursor for the public pages (1069, after vennu-orcin.vercel.app):
 * - a small dot glued to the pointer, drawn in difference blend so it reads on light, dark and lime alike;
 * - a lime ring that glides after it (lerped, so it lags a touch and catches up);
 * - a short fading trail of lime specks behind it while the mouse moves.
 * On anything clickable the dot and ring swell; pressing squeezes the ring. Over text fields (and iframes)
 * all of it steps aside and the normal text cursor shows, so typing and selecting stay native. It hides
 * when the pointer leaves the window.
 *
 * [data-mag] elements (the nav logo and button) also lean toward the pointer, 8px at most, and glide home.
 * They write the CSS `translate` property, so their own hover and press transforms keep working.
 *
 * Mouse and trackpad only: touch, reduced motion and forced colours keep the system cursor. The native
 * cursor is only hidden (html.cfx-on) once the first mouse move has placed ours, so it is never lost if
 * this never runs. Everything is transform-only in one rAF loop that stops when it has settled.
 */
const HOT = "a[href], button:not(:disabled), [role='button'], [role='tab'], [role='switch'], [role='menuitem'], [role='option'], [role='radio'], [role='checkbox'], label, summary, select, [data-cursor='hot']";
const TEXT = "input:not([type='checkbox'], [type='radio'], [type='range'], [type='button'], [type='submit'], [type='color'], [type='file']), textarea, [contenteditable='true'], [contenteditable=''], iframe";
const TRAIL = 6;
const RING = 0.16; // ring catch-up per 60 Hz frame
const LINK = 0.42; // each trail speck chases the one ahead of it
const MAG = 0.22;
const MAG_MAX = 8;
const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

type P = { x: number; y: number };
type Mag = { el: HTMLElement; x: number; y: number };

export function CursorFx() {
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const forced = window.matchMedia("(forced-colors: active)");
    const root = document.documentElement;
    let alive: (() => void) | null = null;

    const start = () => {
      const make = (cls: string, z: number) => {
        const w = document.createElement("div");
        w.className = `cfx ${cls}`;
        w.setAttribute("aria-hidden", "true");
        w.style.zIndex = String(z);
        w.appendChild(document.createElement("i"));
        document.body.appendChild(w);
        return w;
      };
      const trail = Array.from({ length: TRAIL }, (_, i) => {
        const w = make("cfx-trail", 2147482990 + i);
        const f = 1 - i / TRAIL;
        w.style.setProperty("--o", (0.5 * f).toFixed(2));
        w.style.setProperty("--s", (0.45 + 0.55 * f).toFixed(2));
        return w;
      }).reverse(); // nearest speck first
      const ring = make("cfx-ring", 2147483000);
      const dot = make("cfx-dot", 2147483001);
      const els = [...trail, ring, dot];

      const m: P = { x: -100, y: -100 };
      const r: P = { x: -100, y: -100 };
      const t: P[] = trail.map(() => ({ x: -100, y: -100 }));
      const mags = new Map<HTMLElement, Mag>();
      let placed = false;
      let over: Element | null = null;
      let raf = 0;
      let lastT = 0;
      const set = (cls: string, on: boolean) => root.classList.toggle(cls, on);
      const put = (el: HTMLElement, p: P) => (el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`);

      const classify = (el: Element | null) => {
        over = el;
        set("cfx-text", !!el?.closest?.(TEXT));
        set("cfx-hot", !!el?.closest?.(HOT));
      };

      const tick = (now: number) => {
        raf = 0;
        const k = Math.min(3, (now - lastT) / 16.7 || 1); // frame-rate independent lerp
        lastT = now;
        const ease = (a: number) => 1 - Math.pow(1 - a, k);
        let busy = false;
        r.x += (m.x - r.x) * ease(RING);
        r.y += (m.y - r.y) * ease(RING);
        if (Math.abs(m.x - r.x) + Math.abs(m.y - r.y) > 0.2) busy = true;
        else {
          r.x = m.x;
          r.y = m.y;
        }
        put(ring, r);
        put(dot, m);
        t.forEach((p, i) => {
          const lead = i === 0 ? m : t[i - 1];
          p.x += (lead.x - p.x) * ease(LINK);
          p.y += (lead.y - p.y) * ease(LINK);
          if (Math.abs(lead.x - p.x) + Math.abs(lead.y - p.y) > 0.2) busy = true;
          put(trail[i], p);
        });

        const hot = over?.closest?.<HTMLElement>("[data-mag]") ?? null;
        if (hot && !mags.has(hot)) mags.set(hot, { el: hot, x: 0, y: 0 });
        for (const g of mags.values()) {
          let tx = 0;
          let ty = 0;
          if (g.el === hot) {
            const b = g.el.getBoundingClientRect();
            // measured without our own offset, so the target does not chase itself
            tx = clamp((m.x - (b.left - g.x + b.width / 2)) * MAG, MAG_MAX);
            ty = clamp((m.y - (b.top - g.y + b.height / 2)) * MAG, MAG_MAX * 0.75);
          }
          g.x += (tx - g.x) * ease(0.2);
          g.y += (ty - g.y) * ease(0.2);
          if (g.el !== hot && Math.abs(g.x) + Math.abs(g.y) < 0.05) {
            g.el.style.removeProperty("translate");
            mags.delete(g.el);
          } else {
            g.el.style.translate = `${g.x.toFixed(2)}px ${g.y.toFixed(2)}px`;
            if (Math.abs(tx - g.x) + Math.abs(ty - g.y) > 0.05) busy = true;
          }
        }
        if (busy) raf = requestAnimationFrame(tick);
      };
      const kick = () => {
        if (!raf) {
          lastT = performance.now();
          raf = requestAnimationFrame(tick);
        }
      };

      const onMove = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        m.x = e.clientX;
        m.y = e.clientY;
        if (!placed) {
          placed = true;
          r.x = m.x;
          r.y = m.y;
          t.forEach((p) => {
            p.x = m.x;
            p.y = m.y;
          });
          set("cfx-on", true);
        }
        set("cfx-out", false);
        classify(e.target as Element | null);
        kick();
      };
      const onDown = (e: PointerEvent) => e.pointerType === "mouse" && set("cfx-down", true);
      const onUp = () => set("cfx-down", false);
      const onOut = (e: MouseEvent) => {
        if (!e.relatedTarget) set("cfx-out", true);
      };
      // scrolling moves the page under a still pointer: re-check what it is over
      const onScroll = () => {
        if (!placed) return;
        classify(document.elementFromPoint(m.x, m.y));
        kick();
      };
      const onBlur = () => set("cfx-out", true);

      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      window.addEventListener("pointercancel", onUp, { passive: true });
      window.addEventListener("contextmenu", onUp);
      document.addEventListener("mouseout", onOut);
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("blur", onBlur);

      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("contextmenu", onUp);
        document.removeEventListener("mouseout", onOut);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("blur", onBlur);
        for (const g of mags.values()) g.el.style.removeProperty("translate");
        els.forEach((el) => el.remove());
        ["cfx-on", "cfx-out", "cfx-hot", "cfx-text", "cfx-down"].forEach((c) => root.classList.remove(c));
      };
    };

    const sync = () => {
      const want = fine.matches && !reduce.matches && !forced.matches;
      if (want && !alive) alive = start();
      else if (!want && alive) {
        alive();
        alive = null;
      }
    };
    sync();
    const qs = [fine, reduce, forced];
    qs.forEach((q) => q.addEventListener("change", sync));
    return () => {
      qs.forEach((q) => q.removeEventListener("change", sync));
      alive?.();
      alive = null;
    };
  }, []);

  return null;
}
