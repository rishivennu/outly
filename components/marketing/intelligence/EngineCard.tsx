"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { gsap, useGSAP, MOTION_OK } from "@/lib/motion/gsap";
import { GSAP_EASE, sec } from "@/lib/motion/tokens";
import { useEngine } from "./EngineStage";

export interface EnginePart { n: string; name: string; line: string }

const ADVANCE = 3.6;

/**
 * R1341: "How it works", the four parts of the engine as numbered rows, one open at a time. It advances on its own
 * every 3.6 s (GSAP delayedCall, so it shares the one clock), holds while the pointer or focus is on it, while the
 * stage is paused and while the tab is hidden, and under reduced motion it only moves when asked. Every row is a real
 * button (44 px tall, aria-expanded, aria-controls), so the keyboard gets the same card.
 */
export function EngineCard({ title, status, parts, note }: { title: string; status: string; parts: readonly EnginePart[]; note: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(0);
  const [hold, setHold] = useState(false);
  const { paused, live } = useEngine();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const f = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);

  // Auto-advance: one delayedCall, re-armed each step; killed whenever a hold begins (and by the context on unmount).
  useGSAP(() => {
    if (!live || hold || paused || hidden) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const call = gsap.delayedCall(ADVANCE, () => {
        setOpen((o) => (o + 1) % parts.length);
        call.restart(true);
      });
    });
  }, { dependencies: [live, hold, paused, hidden, parts.length], revertOnUpdate: true });

  // The opened line lifts in; the status dot breathes.
  useGSAP(() => {
    const el = root.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const line = el.querySelector<HTMLElement>(`[data-ek-line="${open}"]`);
      if (line) gsap.fromTo(line, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: sec("card"), ease: GSAP_EASE.out, clearProps: "opacity,visibility,transform" });
    });
  }, { dependencies: [open], scope: root });
  useGSAP(() => {
    const dot = root.current?.querySelector(".ek-dot");
    if (!dot) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => { gsap.to(dot, { opacity: 0.35, duration: 1.1, repeat: -1, yoyo: true, ease: "sine.inOut" }); });
  }, { scope: root });

  return (
    <div
      ref={root}
      className="ek-glass rounded-[1.25rem] p-4 sm:p-5"
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocusCapture={() => setHold(true)}
      onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHold(false); }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/70">{title}</p>
        <p className="flex items-center gap-2 text-[12px] text-white/70">
          <span aria-hidden="true" className="ek-dot h-1.5 w-1.5 rounded-full bg-lime" />
          {status}
        </p>
      </div>
      <ul className="mt-3 divide-y divide-white/10">
        {parts.map((p, i) => {
          const isOpen = i === open;
          return (
            <li key={p.n}>
              <button
                type="button"
                id={`ek-part-${i}`}
                className="ek-part flex min-h-11 w-full items-center gap-3 py-2.5 text-left"
                aria-expanded={isOpen}
                aria-controls={`ek-line-${i}`}
                onClick={() => setOpen(i)}
              >
                <span className="ek-num w-7 shrink-0 text-[12px] font-semibold tabular-nums text-white/55">{p.n}</span>
                <span className="flex-1 text-[15px] font-semibold tracking-tight">{p.name}</span>
                <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-white/55 transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`} />
              </button>
              <div id={`ek-line-${i}`} role="region" aria-labelledby={`ek-part-${i}`} hidden={!isOpen}>
                {isOpen && <p data-ek-line={i} className="pb-3 pl-10 text-pretty text-[14px] leading-[1.55] text-white/75">{p.line}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 border-t border-white/10 pt-3 text-pretty text-[13px] leading-[1.5] text-white/60">{note}</p>
    </div>
  );
}
