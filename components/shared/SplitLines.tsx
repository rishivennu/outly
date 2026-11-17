"use client";
import { useEffect, useRef } from "react";
import { splitLinesIn } from "@/lib/motion/split";

type Tag = "h1" | "h2" | "p" | "span" | "div";

/**
 * 1188: a headline that arrives line by line, out of a mask (GSAP SplitText, lib/motion/split.ts).
 *
 * Renders exactly the element it is given, with the same classes, so the typography and the SSR markup are
 * unchanged: the only addition is data-split-lines, which CSS uses to hold the headline at opacity .01 until
 * the lines are ready (never 0, so it still counts as the page's LCP paint) and to show it anyway after 2s
 * if the plugin never arrives. The text is in the HTML, so search engines and screen readers see a plain
 * heading. Reduced motion shows it with no split at all.
 *
 * Only for headlines whose text does not change while the page is open: SplitText rewrites the element's
 * children, so React must not need to reconcile them afterwards.
 */
export function SplitLines({ as = "h1", id, className, children }: { as?: Tag; id?: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => splitLinesIn(ref.current), []);
  const El = as as "h1";
  return (
    <El ref={ref as React.RefObject<HTMLHeadingElement>} id={id} className={className} data-split-lines="">
      {children}
    </El>
  );
}
