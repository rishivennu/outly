"use client";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A scroller with its own slim scrollbar, for the admin sidebar and drawer. The native bar is hidden (on Windows it is
 * a grey box with arrows that ignores the theme); in its place a 4px pill sits inside the panel's right edge, sized to
 * how much of the list is visible. It is invisible at rest, shows softly while the pointer is over the panel and turns
 * lime while scrolling or dragging. The thumb can be dragged, and clicking the rail jumps there. The top and bottom
 * edges fade only when there is more list that way. Wheel, touch and keyboard scrolling are the browser's own.
 */
export function ScrollArea({ className, children }: { className?: string; children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const r = root.current, v = view.current, rl = rail.current, t = thumb.current;
    if (!r || !v || !rl || !t) return;
    let idle = 0, frame = 0, drag: { y: number; top: number; k: number } | null = null;

    const paint = () => {
      frame = 0;
      const sh = v.scrollHeight, ch = v.clientHeight, max = sh - ch;
      r.dataset.over = max > 1 ? "1" : "0";
      if (max <= 1) return;
      const h = rl.clientHeight, th = Math.max(32, Math.round((h * ch) / sh));
      t.style.height = th + "px";
      t.style.transform = `translateY(${((h - th) * v.scrollTop) / max}px)`;
      r.dataset.top = v.scrollTop > 2 ? "0" : "1";
      r.dataset.end = v.scrollTop < max - 2 ? "0" : "1";
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const wake = () => {
      r.dataset.live = "1";
      clearTimeout(idle);
      idle = window.setTimeout(() => { if (!drag) r.dataset.live = "0"; }, 900);
    };
    const onScroll = () => { queue(); wake(); };

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const max = v.scrollHeight - v.clientHeight, free = rl.clientHeight - t.offsetHeight;
      drag = { y: e.clientY, top: v.scrollTop, k: free > 0 ? max / free : 0 };
      t.setPointerCapture(e.pointerId);
      r.dataset.drag = "1"; wake();
    };
    const move = (e: PointerEvent) => { if (drag) v.scrollTop = drag.top + (e.clientY - drag.y) * drag.k; };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      drag = null; r.dataset.drag = "0"; wake();
      if (t.hasPointerCapture(e.pointerId)) t.releasePointerCapture(e.pointerId);
    };
    // Click on the rail (not the thumb): centre the thumb on that point.
    const jump = (e: PointerEvent) => {
      if (e.target !== rl || e.button !== 0) return;
      const box = rl.getBoundingClientRect(), th = t.offsetHeight, free = box.height - th;
      const max = v.scrollHeight - v.clientHeight;
      const at = Math.min(Math.max(e.clientY - box.top - th / 2, 0), free);
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      v.scrollTo({ top: free > 0 ? (at / free) * max : 0, behavior: smooth ? "smooth" : "auto" });
    };

    v.addEventListener("scroll", onScroll, { passive: true });
    t.addEventListener("pointerdown", down);
    t.addEventListener("pointermove", move);
    t.addEventListener("pointerup", up);
    t.addEventListener("pointercancel", up);
    rl.addEventListener("pointerdown", jump);
    const ro = new ResizeObserver(queue);
    ro.observe(v);
    for (const c of Array.from(v.children)) ro.observe(c);
    const mo = new MutationObserver(queue);
    mo.observe(v, { childList: true, subtree: true });
    paint();
    return () => {
      v.removeEventListener("scroll", onScroll);
      t.removeEventListener("pointerdown", down);
      t.removeEventListener("pointermove", move);
      t.removeEventListener("pointerup", up);
      t.removeEventListener("pointercancel", up);
      rl.removeEventListener("pointerdown", jump);
      ro.disconnect(); mo.disconnect();
      clearTimeout(idle); cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={root} className="sa-root" data-over="0" data-top="1" data-end="0">
      <div ref={view} data-lenis-prevent className={cn("sa-view", className)}>
        {children}
      </div>
      <div ref={rail} className="sa-rail" aria-hidden="true">
        <div ref={thumb} className="sa-thumb" />
      </div>
    </div>
  );
}
