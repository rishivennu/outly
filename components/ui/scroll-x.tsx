"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A sideways scroller that never lets its content widen the page. It marks which edges still hide content
 * (data-more="left right") so CSS can fade those edges, and it is focusable so keyboard users can scroll it
 * (axe: scrollable-region-focusable). Used by the admin Table and the few grids that must stay tabular.
 */
export function ScrollX({ label, className, children, focusable = true, ...p }: { label: string; className?: string; children: React.ReactNode; focusable?: boolean } & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [more, setMore] = React.useState("");
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const max = el.scrollWidth - el.clientWidth;
      const next = max <= 1 ? "" : [el.scrollLeft > 1 ? "left" : "", el.scrollLeft < max - 1 ? "right" : ""].filter(Boolean).join(" ");
      setMore((m) => (m === next ? m : next));
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", read); ro?.disconnect(); };
  }, []);
  return (
    <div ref={ref} role="region" aria-label={label} tabIndex={focusable ? 0 : undefined} data-more={more || undefined} className={cn("scroll-x", className)} {...p}>
      {children}
    </div>
  );
}
