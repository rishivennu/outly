"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pageStagger } from "@/lib/motion/reveal";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

let seen = false; // module scope: survives route changes, resets on a full reload

/**
 * Wraps a route segment (used from template.tsx, which remounts on every navigation).
 * The page's top-level blocks settle in one after another (the shared GSAP pageStagger, 10-22) while a
 * three-layer water wave with rolling crests sweeps up and splashes across the screen. The very first load
 * gets neither, so nothing delays paint. Runs before paint (layout effect), so blocks never flash first.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const [first] = useState(() => !seen);
  const [wave, setWave] = useState(!first);
  const ref = useRef<HTMLDivElement>(null);
  useIso(() => (first ? undefined : pageStagger(ref.current, { delay: 0.16 })), []);
  useEffect(() => {
    seen = true;
    if (!wave) return;
    const t = setTimeout(() => setWave(false), 1700);
    return () => clearTimeout(t);
  }, [wave]);
  return (
    <>
      <div ref={ref}>{children}</div>
      {wave && (
        <div className="page-wave" aria-hidden="true">
          <div className="pw-sheet"><span className="pw-crest" /></div>
          <div className="pw-sheet"><span className="pw-crest" /></div>
          <div className="pw-sheet"><span className="pw-crest" /></div>
          <span className="pw-ripple" />
          <span className="pw-ripple" />
        </div>
      )}
    </>
  );
}
