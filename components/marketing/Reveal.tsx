"use client";
import { useEffect, useRef } from "react";
import { registerReveal, type RevealFx } from "@/lib/motion/reveal";

/**
 * Scroll reveal (10-22: GSAP). The element registers with the one reveal engine (lib/motion/reveal.ts),
 * which batches everything entering view together into a single staggered entrance and sets data-shown.
 *
 * Content is only hidden under html.js (set by the inline head script), so it is never lost if JS fails,
 * and anything already on screen at load plays at once. Reduced motion gets a short fade, no movement.
 *
 * fx picks the choreography (1064: all of them are mask reveals, see lib/motion/reveal.ts): "rise" (default,
 * uncovered top to bottom while it lifts), "depth" (an iris that opens with a little scale), "wipe" (sideways,
 * `dir` picks the side), "stagger" (children one after another), "cards" (the recommended plan first, the
 * rest open away from it), "tiles" (bento: the lead tile, then the others outward from it), "rows"
 * (comparison groups), "footer".
 */
export function Reveal({
  children,
  delay = 0,
  y = 22,
  className,
  as: Tag = "div",
  stagger = false,
  fx,
  dir,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: "div" | "li" | "section" | "ul" | "ol";
  /** Children rise one after another instead of the wrapper moving as one block. */
  stagger?: boolean;
  fx?: RevealFx;
  /** "wipe" only: which way it is uncovered. Default: left to right. */
  dir?: "left" | "right";
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerReveal(el);
  }, []);
  return (
    <Tag
      ref={ref as never}
      data-reveal=""
      data-stagger={stagger || fx === "cards" ? "" : undefined}
      data-rv={fx}
      data-dir={dir}
      className={className}
      style={{ ["--reveal-delay" as string]: `${delay}s`, ["--reveal-y" as string]: `${y}px` }}
    >
      {children}
    </Tag>
  );
}
