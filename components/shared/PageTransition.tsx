"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { pageStagger } from "@/lib/motion/reveal";
import { RouteStage } from "./RouteStage";
import { appNavKind, isApp, type AppNav } from "@/lib/app-mode";
import { consumeBack } from "@/lib/client/app-mode";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

let seen = false; // module scope: survives route changes, resets on a full reload
let lastPath: string | null = null;

/**
 * Wraps a route segment (used from template.tsx, which remounts on every navigation).
 * The page's top-level blocks settle in one after another (the shared GSAP pageStagger, 10-22) while a
 * three-layer water wave with rolling crests sweeps up the screen (no splash rings since 1053: the user asked for the circle to go). The very first load
 * gets neither, so nothing delays paint. Runs before paint (layout effect), so blocks never flash first.
 *
 * 1064: the site wave is quicker (about 1.1 s, was 1.7 s) and never blocks a click (pointer-events: none).
 * The studio ("app" variant) drops the wave altogether: a working screen slides in a few pixels sideways and
 * settles in under half a second, and its lower panels settle once as they scroll into view.
 *
 * 1065: the studio hands its routes to RouteStage (lib/motion/route.ts): a sideways mask for a new section,
 * a push for a detail, a slide under the tab bar for a tab, nothing for a query change, and a settle when
 * the page replaces its loader. The Android app keeps its native push and pop below.
 */
export function PageTransition({ children, variant = "site" }: { children: React.ReactNode; variant?: "site" | "app" }) {
  const path = usePathname();
  const [first] = useState(() => !seen);
  // Inside the Android app screens move the iOS way (push, pop, cross-fade, sheet) instead of the web's wave.
  const [kind] = useState<AppNav | null>(() => (isApp() ? appNavKind(first ? null : lastPath, path, consumeBack()) : null));
  const [wave, setWave] = useState(!first && kind === null && variant === "site");
  const ref = useRef<HTMLDivElement>(null);
  useIso(() => {
    if (first || kind !== null || variant === "app") return undefined;
    return pageStagger(ref.current, { delay: 0.12, duration: 0.5, y: 12 });
  }, []);
  useEffect(() => {
    lastPath = path;
  }, [path]);
  useEffect(() => {
    seen = true;
    if (!wave) return;
    const t = setTimeout(() => setWave(false), 1200);
    return () => clearTimeout(t);
  }, [wave]);
  if (variant === "app" && kind === null) return <RouteStage>{children}</RouteStage>;
  return (
    <>
      <div ref={ref} className={kind === "push" || kind === "pop" || kind === "fade" ? `app-enter-${kind}` : undefined}>{children}</div>
      {wave && (
        <div className="page-wave" aria-hidden="true">
          <div className="pw-sheet"><span className="pw-crest" /></div>
          <div className="pw-sheet"><span className="pw-crest" /></div>
          <div className="pw-sheet"><span className="pw-crest" /></div>
        </div>
      )}
    </>
  );
}
