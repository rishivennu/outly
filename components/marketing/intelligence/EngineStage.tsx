"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Minus, Pause, Play, Plus } from "lucide-react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { gsap, useGSAP, MOTION_OK } from "@/lib/motion/gsap";
import { reduced } from "@/lib/motion/prefs";
import { GSAP_EASE, sec } from "@/lib/motion/tokens";
import { HeatField } from "./HeatField";
import { LEVELS, LEVEL_DEFAULT, clampLevel } from "./heat";

gsap.registerPlugin(ScrollTrigger);

/** What the stage shares with its client children (EngineCard pauses its auto-advance with the kiln). */
export const EngineCtx = createContext<{ paused: boolean; live: boolean }>({ paused: false, live: false });
export const useEngine = () => useContext(EngineCtx);

const HEAD_GAP = 32;

/**
 * R1341: the dark stage the kiln burns in. The children are server-rendered (IntelligenceEngine.tsx): the glass
 * window, the headline block (marked data-ek-head) and the card. The field fills the stage from the top down to
 * HEAD_GAP above the headline, measured here and kept in step by a ResizeObserver, so the ragged bottom edge always
 * drips towards the words.
 *
 * Motion (GSAP, once, time-based): when the stage scrolls to 75 % of the viewport the field is armed (HeatField runs
 * the reveal tween) and the .ek-rise pieces lift in with a stagger. The hidden pre-state is CSS under html.js until
 * this arms (data-ek="live"), with a 3 s failsafe, so no JS means everything is simply there. Reduced motion: no
 * timeline, the field is one still frame and the intensity controls are not offered.
 */
export function EngineStage({ word, alt, children }: { word: string; alt: string; children: React.ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [level, setLevel] = useState<number>(LEVEL_DEFAULT);
  const [paused, setPaused] = useState(false);
  const [armed, setArmed] = useState(false);
  const [still, setStill] = useState(false);

  // Field height = headline top - gap, re-measured whenever the stage or the headline changes size.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const head = el.querySelector<HTMLElement>("[data-ek-head]");
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const h = head ? head.getBoundingClientRect().top - top - HEAD_GAP : el.clientHeight * 0.55;
      setHeight(Math.max(120, Math.round(h)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (head) ro.observe(head);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { setStill(reduced()); }, []);

  useGSAP(() => {
    const el = stage.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const rise = gsap.utils.toArray<HTMLElement>(".ek-rise", el);
      gsap.set(rise, { autoAlpha: 0, y: 14 });
      el.dataset.ek = "live";
      const tl = gsap.timeline({
        paused: true,
        defaults: { duration: sec("section"), ease: GSAP_EASE.out },
        onComplete: () => gsap.set(rise, { clearProps: "opacity,visibility,transform" }),
      });
      tl.to(rise, { autoAlpha: 1, y: 0, stagger: 0.09 }, 0.25);
      ScrollTrigger.create({
        trigger: el,
        start: "top 75%",
        once: true,
        onEnter: () => { setArmed(true); tl.play(); },
        // Already past it when the page settled: land on the final state, no entrance.
        onRefresh: (self) => { if (self.progress === 1) { setArmed(true); tl.progress(1); } },
      });
    });
    mm.add("(prefers-reduced-motion: reduce)", () => {
      el.dataset.ek = "live";
      setArmed(true);
    });
  }, { scope: stage });

  const L = clampLevel(level);
  return (
    <EngineCtx.Provider value={{ paused: paused || still, live: armed }}>
      <div ref={stage} className="ek-stage relative overflow-hidden rounded-[1.75rem]" data-ek="">
        <HeatField word={word} level={L} paused={paused} armed={armed} height={height} />
        <p className="sr-only">{alt}</p>
        {children}
        {!still && (
          <div className="ek-rise ek-glass absolute right-4 top-4 z-10 flex items-center gap-1 rounded-full p-1 sm:right-6 sm:top-6" role="group" aria-label="Field intensity">
            <button type="button" className="ek-ctl grid h-11 w-11 place-items-center rounded-full" aria-label="Calmer field" disabled={L === 0} onClick={() => setLevel((v) => clampLevel(v - 1))}>
              <Minus aria-hidden="true" className="h-4 w-4" />
            </button>
            <button type="button" className="ek-ctl grid h-11 w-11 place-items-center rounded-full" aria-label={paused ? "Play the field" : "Pause the field"} aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
              {paused ? <Play aria-hidden="true" className="h-4 w-4" /> : <Pause aria-hidden="true" className="h-4 w-4" />}
            </button>
            <button type="button" className="ek-ctl grid h-11 w-11 place-items-center rounded-full" aria-label="Hotter field" disabled={L === LEVELS.length - 1} onClick={() => setLevel((v) => clampLevel(v + 1))}>
              <Plus aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </EngineCtx.Provider>
  );
}
