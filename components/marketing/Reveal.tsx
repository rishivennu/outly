"use client";
import { useEffect, useRef } from "react";

/**
 * Scroll reveal without an animation library: one shared IntersectionObserver flips
 * data-shown and CSS does the transition on the compositor (opacity + transform).
 *
 * Content is only hidden under html.js (set by the inline head script), so it is
 * never lost if JS fails, and anything already on screen at load is shown at once.
 * Reduced motion keeps a short fade and drops the movement (globals.css).
 */
let io: IntersectionObserver | null = null;
function observer() {
  if (io || typeof IntersectionObserver === "undefined") return io;
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          (e.target as HTMLElement).dataset.shown = "";
          io!.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
  );
  return io;
}

export function Reveal({
  children,
  delay = 0,
  y = 22,
  className,
  as: Tag = "div",
  stagger = false,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: "div" | "li" | "section" | "ul" | "ol";
  /** Children rise one after another instead of the wrapper moving as one block. */
  stagger?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const o = observer();
    if (!o) {
      el.dataset.shown = "";
      return;
    }
    o.observe(el);
    return () => o.unobserve(el);
  }, []);
  return (
    <Tag
      ref={ref as never}
      data-reveal=""
      data-stagger={stagger ? "" : undefined}
      className={className}
      style={{ ["--reveal-delay" as string]: `${delay}s`, ["--reveal-y" as string]: `${y}px` }}
    >
      {children}
    </Tag>
  );
}
