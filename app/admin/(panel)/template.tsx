"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { pageStagger } from "@/lib/motion/reveal";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Remounts on each admin navigation: the page's panels settle in one after another (the shared GSAP
 * pageStagger, 10-22). Kept short and close to the ground, since this is a working console. Reduced motion: none.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useIso(() => pageStagger(ref.current, { duration: 0.4, y: 8 }), []);
  return <div ref={ref}>{children}</div>;
}
