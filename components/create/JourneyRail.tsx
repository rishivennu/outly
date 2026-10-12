"use client";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEPS, type Step } from "./types";
import { createFont } from "./font";

interface Props {
  step: Step;
  reachable: Record<Step, boolean>;
  onGo: (s: Step) => void;
  thumb?: string | null;
  title?: string | null;
  saved?: "idle" | "saving" | "saved" | "error";
}

export function JourneyRail({ step, reachable, onGo, thumb, title, saved }: Props) {
  const idx = STEPS.findIndex((s) => s.id === step);
  return (
    <nav aria-label="Your journey" className={cn(createFont.variable, "font-create sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col px-5 py-10 xl:flex")}>
      <div className="mb-8 px-1">
        <p className="eyebrow">New creation</p>
        <p className="mt-2 font-create text-[1.35rem] font-semibold leading-tight tracking-[-0.03em]">
          Step {idx + 1} <span className="text-muted-foreground">of {STEPS.length}</span>
        </p>
        <span className="mt-3 block h-1.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden="true">
          <motion.span className="block h-full rounded-full energy-bg" initial={false} animate={{ width: `${((idx + 1) / STEPS.length) * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
        </span>
      </div>
      <ol className="relative space-y-1">
        {/* Thread connecting the steps, filled up to the current one */}
        <span className="absolute bottom-6 left-[19px] top-6 w-px bg-border" aria-hidden="true" />
        <motion.span className="absolute left-[19px] top-6 w-px bg-lime" aria-hidden="true" animate={{ height: `calc(${(idx / (STEPS.length - 1)) * 100}% - ${idx === STEPS.length - 1 ? 48 : 0}px)` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
        {STEPS.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          const can = reachable[s.id] && !active;
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={!can}
                onClick={() => onGo(s.id)}
                aria-current={active ? "step" : undefined}
                className={cn("group relative flex w-full items-center gap-3.5 rounded-2xl py-2.5 pr-2 text-left transition-[background-color,box-shadow,opacity] duration-300", active && "bg-card/80 shadow-[0_10px_30px_-18px_hsl(var(--foreground)/0.35)] hairline", can && "hover:bg-secondary/60", !reachable[s.id] && "opacity-45")}
              >
                <span
                  className={cn(
                    "relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full text-[13px] font-semibold tabular transition-colors",
                    active ? "lime-bg lime-glow" : done ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hairline",
                  )}
                >
                  {done ? <Check className="h-4 w-4" strokeWidth={3} /> : s.n}
                </span>
                <span className="min-w-0">
                  <span className={cn("block font-create text-[15px] font-semibold tracking-[-0.01em]", active ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
                  <span className="block text-[12.5px] text-muted-foreground">{done ? "Done" : s.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {thumb && idx > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-auto">
          <div className="relative aspect-[9/16] w-24 overflow-hidden rounded-2xl hairline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          </div>
          {title && <p className="mt-3 line-clamp-2 text-sm font-medium">{title}</p>}
          {saved && saved !== "idle" && (
            <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
              {saved === "saving" ? "Saving…" : saved === "saved" ? "Draft saved" : "Couldn't save. We'll keep trying."}
            </p>
          )}
        </motion.div>
      )}
    </nav>
  );
}

/** Compact stepper for small screens. */
export function JourneyBar({ step, reachable, onGo }: Pick<Props, "step" | "reachable" | "onGo">) {
  const idx = STEPS.findIndex((s) => s.id === step);
  return (
    <nav aria-label="Your journey" className={cn(createFont.variable, "font-create glass sticky top-0 z-30 mx-3 mt-1 rounded-[22px] px-4 py-3 xl:hidden")}>
      <ol className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex flex-1 flex-col gap-1.5">
            <button type="button" disabled={!reachable[s.id] || i === idx} onClick={() => onGo(s.id)} aria-current={i === idx ? "step" : undefined} className="flex min-h-[44px] flex-col justify-center gap-1.5 text-left">
              <span className={cn("h-1 w-full rounded-full", i < idx ? "bg-foreground" : i === idx ? "bg-lime" : "bg-secondary")} />
              <span className={cn("font-create text-[12.5px] font-semibold tracking-[-0.005em]", i === idx ? "text-foreground" : "text-muted-foreground")}>
                <span className="tabular">{s.n}</span> <span className={cn(i !== idx && "sr-only sm:not-sr-only")}>{s.label}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
