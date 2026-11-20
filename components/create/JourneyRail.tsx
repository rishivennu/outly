"use client";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEPS, type Step } from "./types";
import { createFont } from "./font";
import { T } from "@/lib/motion/tokens";
import { CaptionRunPill } from "./captions/CaptionRun";

interface Props {
  step: Step;
  reachable: Record<Step, boolean>;
  onGo: (s: Step) => void;
  /** Phase 3 (B2G): the compact draft status chip (SyncStatus) at the foot of the rail, in place of the old preview card. */
  status?: React.ReactNode;
  /** P4: the post was sent or booked: every step shows Done, nothing is clickable. */
  complete?: boolean;
}

/** Shown from 1280px on every step; below that the compact JourneyBar takes its place. */
export const RAIL_SHOW = "xl:flex";
export const BAR_HIDE = "xl:hidden";

export function JourneyRail({ step, reachable, onGo, status, complete }: Props) {
  const at = STEPS.findIndex((s) => s.id === step);
  const idx = complete ? STEPS.length : at;
  return (
    <nav aria-label="Your journey" className={cn(createFont.variable, "font-create sticky top-0 hidden h-dvh w-[200px] shrink-0 flex-col px-3 py-6", RAIL_SHOW)}>
      <div className="mb-5 px-1.5">
        <p className="eyebrow">New creation</p>
        <p className="mt-1.5 font-create text-lg font-semibold leading-tight tracking-[-0.02em] tabular-nums">
          Step {Math.min(idx, STEPS.length - 1) + 1} <span className="text-muted-foreground">of {STEPS.length}</span>
        </p>
        <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-secondary" aria-hidden="true">
          <motion.span className="block h-full w-full origin-left rounded-full energy-bg" initial={false} animate={{ scaleX: Math.min(idx + 1, STEPS.length) / STEPS.length }} transition={T.fill} />
        </span>
      </div>
      <ol className="relative space-y-0.5">
        {/* Thread connecting the steps, filled up to the current one */}
        <span className="absolute bottom-6 left-[23px] top-6 w-px bg-border" aria-hidden="true" />
        <motion.span className="absolute bottom-6 left-[23px] top-6 w-px origin-top bg-lime" aria-hidden="true" initial={false} animate={{ scaleY: Math.min(idx, STEPS.length - 1) / (STEPS.length - 1) }} transition={T.fill} />
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
                className={cn(
                  "group relative flex min-h-11 w-full items-center gap-3 rounded-2xl py-1.5 pl-1.5 pr-2 text-left outline-none transition-[background-color,box-shadow,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                  active && "bg-card/80 shadow-[0_10px_30px_-18px_hsl(var(--foreground)/0.35)] hairline",
                  can && "[@media(hover:hover)]:hover:bg-secondary/60",
                  !reachable[s.id] && "opacity-45",
                )}
              >
                <span
                  className={cn(
                    "relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold tabular transition-colors duration-300 motion-reduce:transition-none",
                    active ? "lime-bg lime-glow" : done ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hairline",
                  )}
                >
                  {done ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" /> : s.n}
                </span>
                <span className="min-w-0">
                  <span className={cn("block truncate font-create text-sm font-semibold tracking-[-0.01em]", active ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{done ? "Done" : active ? "You're here" : s.hint}</span>
                  {/* Phase 4: captions keep running on every step; their progress shows on the step that has them. */}
                  {s.id === "story" && <CaptionRunPill />}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {status && <div className="mt-auto min-w-0 px-1.5">{status}</div>}
    </nav>
  );
}

/** Compact stepper for tablets and phones. */
export function JourneyBar({ step, reachable, onGo }: Pick<Props, "step" | "reachable" | "onGo">) {
  const idx = STEPS.findIndex((s) => s.id === step);
  return (
    <nav aria-label="Your journey" className={cn(createFont.variable, "font-create glass sticky top-[var(--sa-t)] z-30 mx-3 mt-1 rounded-[22px] px-4 py-3", BAR_HIDE)}>
      <ol className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <button type="button" disabled={!reachable[s.id] || i === idx} onClick={() => onGo(s.id)} aria-current={i === idx ? "step" : undefined} className="flex min-h-[44px] min-w-0 flex-col justify-center gap-1.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className={cn("h-1 w-full rounded-full transition-colors duration-300 motion-reduce:transition-none", i < idx ? "bg-foreground" : i === idx ? "bg-lime" : "bg-secondary")} />
              <span className={cn("truncate font-create text-[13px] font-semibold tracking-[-0.005em]", i === idx ? "text-foreground" : "text-muted-foreground")}>
                <span className="tabular">{s.n}</span> <span className={cn(i !== idx && "sr-only sm:not-sr-only")}>{s.label}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
