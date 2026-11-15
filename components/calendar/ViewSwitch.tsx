"use client";
import { useRef } from "react";
import { motion } from "framer-motion";
import { ease } from "@/lib/motion/tokens";
import { VIEWS, VIEW_LABEL, type CalView } from "@/lib/calendar/range";
import { cn } from "@/lib/utils";

/** Day / Week / Month / Upcoming. A radio group: arrows move along it, the pill slides to the pick. */
export function ViewSwitch({ value, onChange, className }: { value: CalView; onChange: (v: CalView) => void; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent) => {
    const i = VIEWS.indexOf(value);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? VIEWS.length - 1 : step ? (i + step + VIEWS.length) % VIEWS.length : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(VIEWS[to]);
    refs.current[to]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Calendar view" onKeyDown={onKey} className={cn("inline-flex w-full rounded-full bg-secondary/70 p-1 hairline sm:w-auto", className)}>
      {VIEWS.map((v, i) => {
        const on = v === value;
        return (
          <button
            key={v}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(v)}
            className={cn(
              "relative min-h-11 flex-1 rounded-full px-3 text-sm font-medium transition-colors duration-200 active:scale-[0.96] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-none sm:px-4",
              on ? "text-foreground" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground",
            )}
          >
            {on && <motion.span layoutId="cal-view-pill" className="absolute inset-0 rounded-full bg-background shadow-sm hairline" transition={{ duration: 0.3, ease: ease("swap") }} aria-hidden="true" />}
            <span className="relative">{VIEW_LABEL[v]}</span>
          </button>
        );
      })}
    </div>
  );
}
