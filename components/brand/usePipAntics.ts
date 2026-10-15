"use client";
import { useEffect, useState } from "react";
import type { PipMood } from "./Pip";

export type PipAct = { mood: PipMood; say: string };

/** Little gibberish bits Pip loops through when nobody is around. */
export const PIP_ACTS: PipAct[] = [
  { mood: "wave", say: "blip bloop?" },
  { mood: "think", say: "hmm... zibble" },
  { mood: "dizzy", say: "wobba wobba" },
  { mood: "fly", say: "wheee!" },
  { mood: "happy", say: "mrrp mrrp!" },
  { mood: "wait", say: "anybody? boop" },
  { mood: "sleepy", say: "zzz... snrk" },
];

const EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * After `idleMs` with no pointer, key, wheel, touch or scroll, returns Pip's current act and moves to
 * the next one every `stepMs`, looping until someone does anything. Then it returns null straight away.
 * Paused while the tab is hidden.
 */
export function usePipAntics(idleMs = 9000, stepMs = 2800, enabled = true): PipAct | null {
  const [i, setI] = useState(-1);
  useEffect(() => {
    if (!enabled) return;
    let idleT: number | undefined;
    let stepT: number | undefined;
    let idle = false;
    const stop = () => {
      window.clearTimeout(idleT);
      window.clearInterval(stepT);
    };
    const start = () => {
      idle = true;
      setI(0);
      stepT = window.setInterval(() => setI((n) => (n + 1) % PIP_ACTS.length), stepMs);
    };
    const arm = () => {
      stop();
      if (idle) {
        idle = false;
        setI(-1);
      }
      if (!document.hidden) idleT = window.setTimeout(start, idleMs);
    };
    const opt = { passive: true, capture: true } as const;
    EVENTS.forEach((e) => window.addEventListener(e, arm, opt));
    document.addEventListener("visibilitychange", arm);
    arm();
    return () => {
      stop();
      EVENTS.forEach((e) => window.removeEventListener(e, arm, opt));
      document.removeEventListener("visibilitychange", arm);
    };
  }, [idleMs, stepMs, enabled]);
  return i >= 0 ? PIP_ACTS[i] : null;
}
