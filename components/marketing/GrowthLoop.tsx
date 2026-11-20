"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { GSAP_EASE, sec } from "@/lib/motion/tokens";
import { reduced, simple } from "@/lib/motion/prefs";

gsap.registerPlugin(ScrollTrigger);

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// The lime fill reaches node i at i/3 of TRACK, and the node lights as it arrives.
const TRACK = 0.7;
const SHUT_X = "inset(0% 100% 0% 0%)";
const SHUT_X_RTL = "inset(0% 0% 0% 100%)";
const SHUT_Y = "inset(0% 0% 100% 0%)";
const OPEN = "inset(0% 0% 0% 0%)";

/**
 * R1263: the one owner of the growth loop's motion (Candidate A, "track draw + node ignition"), played once when it
 * scrolls in. The markup is server-rendered by GrowthEngine; the hidden pre-state is CSS under html.js until this
 * arms (data-ge="live"), so there is no flash and nothing stays hidden without JS. Cards keep their own <Reveal>.
 */
export function GrowthLoop({ children, className }: { children: React.ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useIso(() => {
    const el = root.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(el);
      const fill = q(".ge-track-fill");
      const lit = q(".ge-node-lit");
      const label = q(".ge-label");
      const hint = q(".ge-hint");
      const note = q(".ge-note");
      const ret = q(".ge-return");

      if (reduced()) {
        el.dataset.ge = "live";
        return;
      }

      const lite = simple();
      const vertical = !matchMedia("(min-width: 640px)").matches;
      const rtl = getComputedStyle(el).direction === "rtl";
      const shut = vertical ? SHUT_Y : rtl ? SHUT_X_RTL : SHUT_X;

      gsap.set(fill, lite ? { clipPath: OPEN, autoAlpha: 0 } : { clipPath: shut });
      gsap.set(lit, { autoAlpha: 0, scale: lite ? 1 : 0.6 });
      gsap.set([...label, ...hint, ...note], { autoAlpha: 0, y: 8 });
      if (!lite) gsap.set(ret, { rotation: -90 });
      el.dataset.ge = "live";

      const text = [...label, ...hint, ...note, ...ret];
      const tl = gsap.timeline({
        paused: true,
        defaults: { duration: sec("card"), ease: GSAP_EASE.out },
        onComplete: () => gsap.set(text, { clearProps: "opacity,visibility,transform" }),
      });
      if (lite) tl.to(fill, { autoAlpha: 1, duration: 0.3, ease: GSAP_EASE.fade }, 0);
      else tl.to(fill, { clipPath: OPEN, duration: TRACK, ease: GSAP_EASE.smooth }, 0);
      lit.forEach((node, i) => {
        const at = lite ? i * 0.08 : (i / 3) * TRACK;
        tl.to(node, { autoAlpha: 1, scale: 1 }, at)
          .to(label[i], { autoAlpha: 1, y: 0 }, at + 0.05)
          .to(hint[i], { autoAlpha: 1, y: 0 }, at + 0.11);
      });
      const end = lite ? 0.4 : TRACK + 0.15;
      tl.to(note, { autoAlpha: 1, y: 0 }, end);
      if (!lite) tl.to(ret, { rotation: 0 }, end);

      ScrollTrigger.create({
        trigger: el,
        start: "top 80%",
        once: true,
        onEnter: () => tl.play(),
        // Scrolled (or loaded) past it before it could play: land on the final state.
        onRefresh: (self) => {
          if (self.progress === 1) tl.progress(1);
        },
      });
    }, root);
    return () => ctx.revert();
  }, []);
  return (
    <div ref={root} className={className ? `ge-loop ${className}` : "ge-loop"} data-ge="">
      {children}
    </div>
  );
}
