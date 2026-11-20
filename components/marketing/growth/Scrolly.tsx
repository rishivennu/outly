"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { GSAP_EASE, sec } from "@/lib/motion/tokens";
import { reduced } from "@/lib/motion/prefs";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const LG = "(min-width: 1024px)";
// A thin band at the viewport centre: the step crossing it is the active one.
const BAND = "-45% 0px -45% 0px";

/**
 * R1278: the Growth Engine "film strip" from lg. The markup is server-rendered by GrowthEngine (the steps are the
 * .ge-item list, the sticky .ge-stage holds one .ge-frame per step). An IntersectionObserver band picks the active
 * step; changing it tweens the strip to that frame at the section pace, time-based, never scrubbed. No pin: the
 * landing's panel stack already pins and pins cannot nest, so the stage is position: sticky. Below lg nothing runs.
 */
export function Scrolly({ children, className }: { children: React.ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useIso(() => {
    const el = root.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add(LG, (ctx) => {
      const steps = Array.from(el.querySelectorAll<HTMLElement>(".ge-item"));
      const strip = el.querySelector<HTMLElement>(".ge-strip");
      const frames = Array.from(el.querySelectorAll<HTMLElement>(".ge-frame"));
      if (!strip || !steps.length) return;
      const still = reduced();
      let at = -1;

      const show = (i: number) => {
        if (i < 0 || i === at) return;
        const first = at < 0;
        at = i;
        steps.forEach((s, n) => s.toggleAttribute("data-on", n === i));
        strip.dataset.i = String(i);
        if (still || first) {
          gsap.set(strip, { yPercent: -i * 100 });
          gsap.set(frames, { scale: 1, opacity: 1 });
          return;
        }
        gsap
          .timeline({ defaults: { duration: sec("section"), ease: GSAP_EASE.out, overwrite: "auto" } })
          .to(strip, { yPercent: -i * 100 }, 0)
          .fromTo(frames[i], { scale: 0.96, opacity: 0.6 }, { scale: 1, opacity: 1 }, 0);
      };

      show(0);
      el.dataset.live = "";

      const hit = new Set<Element>();
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) hit.add(e.target);
            else hit.delete(e.target);
          }
          if (!hit.size) return; // above or below the list: keep the last step
          const mid = innerHeight / 2;
          let best = -1;
          let gap = Infinity;
          for (const t of hit) {
            const r = t.getBoundingClientRect();
            const d = Math.abs(r.top + r.height / 2 - mid);
            if (d < gap) {
              gap = d;
              best = steps.indexOf(t as HTMLElement);
            }
          }
          // ctx.add records the tween, so leaving lg (or unmounting) reverts it with the rest.
          ctx.add(() => show(best));
        },
        { rootMargin: BAND },
      );
      steps.forEach((s) => io.observe(s));

      return () => {
        io.disconnect();
        steps.forEach((s) => s.removeAttribute("data-on"));
        delete strip.dataset.i;
        delete el.dataset.live;
      };
    });
    return () => mm.revert();
  }, []);
  return (
    <div ref={root} className={className ? `ge-scrolly ${className}` : "ge-scrolly"}>
      {children}
    </div>
  );
}
