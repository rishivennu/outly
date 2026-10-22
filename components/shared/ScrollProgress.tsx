"use client";
import { useEffect, useRef } from "react";

/**
 * Scroll progress as a frame around the whole screen (every page, mounted once in the root layout). It starts at the top
 * centre, runs out to both corners, down both sides and along the bottom, and closes at the bottom centre exactly when the
 * page reaches its end; closing it gives one soft glow pulse. Each side is split by real length (width vs height), so the
 * line moves at one steady speed all the way round. Six edge bars scaled with transforms: no layout, no SVG quirks, the
 * same in every browser. Hidden when a page does not scroll; decorative only (aria-hidden).
 */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = document.documentElement;
    let raf = 0;
    // Sizes are measured only when something resizes, and the scroll position is read in the scroll event itself.
    // Reading layout inside the frame, after other code has written styles, forces a full layout on every scroll frame.
    let y = window.scrollY, max = 0, w = 1, h = 1;
    const last = { t: "", s: "", b: "", on: "", done: "" };
    const set = (k: "t" | "s" | "b", name: string, v: string) => {
      if (last[k] !== v) el.style.setProperty(name, (last[k] = v));
    };
    const flag = (k: "on" | "done", v: string) => {
      if (last[k] !== v) el.dataset[k] = last[k] = v;
    };
    const tick = () => {
      raf = 0;
      const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      const d = p * (w + h + w); // one side of the frame: half top + full side + half bottom
      const top = Math.min(d, w) / w, side = Math.min(Math.max(d - w, 0), h) / h, bottom = Math.min(Math.max(d - w - h, 0), w) / w;
      set("t", "--pt", top.toFixed(4));
      set("s", "--ps", side.toFixed(4));
      set("b", "--pb", bottom.toFixed(4));
      flag("on", max > 8 ? "1" : "0");
      flag("done", max > 8 && p > 0.999 ? "1" : "0");
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const on = () => {
      y = window.scrollY;
      queue();
    };
    const measure = () => {
      max = html.scrollHeight - window.innerHeight;
      w = window.innerWidth / 2;
      h = window.innerHeight;
      on();
    };
    measure();
    tick();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, []);
  return (
    <div ref={ref} aria-hidden="true" className="scroll-frame" data-on="0" data-done="0">
      <i className="sf-t sf-l" /><i className="sf-t sf-r" />
      <i className="sf-s sf-l" /><i className="sf-s sf-r" />
      <i className="sf-b sf-l" /><i className="sf-b sf-r" />
    </div>
  );
}
