"use client";
import { useEffect, useRef } from "react";
import { getLenis } from "./SmoothScroll";

/**
 * The page scrollbar on every page (root layout): the same 4px pill as the admin sidebar (components/admin/ScrollArea.tsx), so it
 * looks identical in Chrome, Edge, Firefox and Safari instead of each browser's own bar (a grey box with arrows on
 * Windows). The native page bar is hidden in CSS (html:has(.pb-rail), so there is no layout jump on hydration). The pill
 * rests soft, turns lime with a faint glow while scrolling, widens to 6px under the pointer, can be dragged, and a click
 * on the rail jumps there. Wheel, keyboard and touch scrolling are untouched. Touch screens keep their own overlay bar.
 * When Lenis smooth scroll is running, drags and jumps go through it so the two never fight.
 */
export function PageScrollbar() {
  const rail = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rl = rail.current, t = thumb.current;
    if (!rl || !t) return;
    const html = document.documentElement;
    let idle = 0, frame = 0, drag: { y: number; top: number; k: number } | null = null;

    // Sizes are cached and re-measured only on resize; the scroll position is read in the scroll event. Reading layout inside
    // the frame, after other code has written styles, would force a full layout on every scroll frame.
    let sh = 0, vh = 0, rh = 0, sy = window.scrollY, lastTh = -1, lastY = "", lastOver = "";
    const max = () => sh - vh;
    const paint = () => {
      frame = 0;
      const m = max();
      const over = m > 1 ? "1" : "0";
      if (over !== lastOver) rl.dataset.over = lastOver = over;
      if (m <= 1) return;
      const th = Math.max(40, Math.round((rh * vh) / sh));
      const ty = `translateY(${(((rh - th) * Math.min(Math.max(sy, 0), m)) / m).toFixed(1)}px)`;
      if (th !== lastTh) t.style.height = (lastTh = th) + "px";
      if (ty !== lastY) t.style.transform = lastY = ty;
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const measure = () => {
      sh = html.scrollHeight; vh = window.innerHeight; rh = rl.clientHeight; sy = window.scrollY;
      queue();
    };
    const wake = () => {
      if (rl.dataset.live !== "1") rl.dataset.live = "1";
      clearTimeout(idle);
      idle = window.setTimeout(() => { if (!drag) rl.dataset.live = "0"; }, 900);
    };
    const onScroll = () => { sy = window.scrollY; queue(); wake(); };
    const go = (y: number, smooth: boolean) => {
      const l = getLenis();
      if (l) l.scrollTo(y, { immediate: !smooth, force: true });
      else window.scrollTo({ top: y, behavior: smooth ? "smooth" : "auto" });
    };

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const free = rl.clientHeight - t.offsetHeight;
      drag = { y: e.clientY, top: window.scrollY, k: free > 0 ? max() / free : 0 };
      t.setPointerCapture(e.pointerId);
      rl.dataset.drag = "1"; wake();
    };
    const move = (e: PointerEvent) => { if (drag) go(drag.top + (e.clientY - drag.y) * drag.k, false); };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      drag = null; rl.dataset.drag = "0"; wake();
      if (t.hasPointerCapture(e.pointerId)) t.releasePointerCapture(e.pointerId);
    };
    // Click on the rail (not the thumb): centre the thumb on that point.
    const jump = (e: PointerEvent) => {
      if (e.target !== rl || e.button !== 0) return;
      const box = rl.getBoundingClientRect(), th = t.offsetHeight, free = box.height - th;
      const at = Math.min(Math.max(e.clientY - box.top - th / 2, 0), free);
      go(free > 0 ? (at / free) * max() : 0, !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    t.addEventListener("pointerdown", down);
    t.addEventListener("pointermove", move);
    t.addEventListener("pointerup", up);
    t.addEventListener("pointercancel", up);
    rl.addEventListener("pointerdown", jump);
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    measure();
    paint();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      t.removeEventListener("pointerdown", down);
      t.removeEventListener("pointermove", move);
      t.removeEventListener("pointerup", up);
      t.removeEventListener("pointercancel", up);
      rl.removeEventListener("pointerdown", jump);
      ro.disconnect();
      clearTimeout(idle); cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={rail} className="pb-rail" aria-hidden="true" data-over="0">
      <div ref={thumb} className="pb-thumb" />
    </div>
  );
}
