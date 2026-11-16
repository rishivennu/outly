"use client";
import { useEffect, useRef } from "react";

/**
 * Why Outlly (1161): the grid's clock. The six previews loop on CSS keyframes (transform and opacity only); this
 * wrapper sets data-live while the grid is on screen and the tab is visible, and the keyframes only run then
 * (globals.css: .usp-grid[data-live] ...). Reduced motion keeps the final frame of every preview, no loops.
 */
export function Stage({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let seen = false;
    const apply = () => {
      if (seen && !document.hidden) el.setAttribute("data-live", "");
      else el.removeAttribute("data-live");
    };
    const io = new IntersectionObserver(
      ([e]) => {
        seen = e.isIntersecting;
        apply();
      },
      { threshold: 0.08 },
    );
    io.observe(el);
    document.addEventListener("visibilitychange", apply);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", apply);
    };
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
