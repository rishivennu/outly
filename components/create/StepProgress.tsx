"use client";
import { useEffect, useId, useState } from "react";
import { motion } from "framer-motion";
import { Check, ChevronLeft, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEPS, type Step } from "./types";
import { createFont } from "./font";
import { T } from "@/lib/motion/tokens";
import { CaptionRunPill } from "./captions/CaptionRun";

/**
 * 1170: the one progress indicator for all four creation steps (it replaced the 200px JourneyRail and the
 * tablet JourneyBar). A slim row of four numbered steps on a thin line from 768px; below that "Step 2 of 4"
 * with a progress bar and how much is done. Kept visually secondary: no cards, about 56px tall.
 *
 * A step is done once the creator has moved past it (`furthest`), and stays done when they go back. Done
 * steps can be revisited; a step whose requirements are not met says why (`blocked`) instead of doing nothing.
 */
export interface StepProgressProps {
  step: Step;
  /** The furthest step reached this session; everything before it shows as done. */
  furthest?: Step;
  /** Which steps can be opened right now. */
  reachable: Record<Step, boolean>;
  /** Why a step can't be opened yet, in plain words. Shown when it is pressed. */
  blocked?: Partial<Record<Step, string>>;
  onGo: (s: Step) => void;
  /** The post was sent or booked: every step is done and nothing is clickable. */
  complete?: boolean;
  /** Small draft controls at the end of the row (sync status, Start over). */
  trailing?: React.ReactNode;
  className?: string;
}

// The pure step logic lives apart (no fonts or motion), so tests import it without the screen.
import { donePercent, stepIndex, stepStates } from "./step-states";
export { donePercent, stepIndex, stepStates };

export function StepProgress({ step, furthest, reachable, blocked, onGo, complete, trailing, className }: StepProgressProps) {
  const items = stepStates(step, furthest, reachable, complete);
  const at = stepIndex(step);
  const [why, setWhy] = useState<string | null>(null);
  const whyId = useId();
  useEffect(() => setWhy(null), [step]);
  const current = items[at];
  const back = !complete && at > 0 && reachable[STEPS[at - 1].id] ? STEPS[at - 1] : null;
  const pct = donePercent(step, complete);

  const press = (s: (typeof items)[number]) => {
    if (s.canGo) return onGo(s.id);
    if (s.state === "current" || complete) return;
    setWhy(blocked?.[s.id] ?? `Finish ${current.label} first.`);
  };

  return (
    <nav aria-label="Creation steps" data-testid="step-progress" className={cn(createFont.variable, "font-create", className)}>
      {/* Phones: one line and a bar, never four squeezed labels. */}
      <div className="md:hidden">
        <div className="flex min-h-11 items-center gap-2">
          {back && (
            <button type="button" onClick={() => onGo(back.id)} className="-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:bg-secondary" aria-label={`Back to ${back.label}`}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.005em]" aria-current="step">
            <span className="tabular-nums">Step {complete ? STEPS.length : at + 1} of {STEPS.length}</span>
            <span className="text-muted-foreground" aria-hidden="true"> · </span>
            <span>{complete ? "Sent" : current.label}</span>
          </p>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{pct}% done</span>
        </div>
        <span className="block h-1 w-full overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Creation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <motion.span className="block h-full w-full origin-left rounded-full bg-lime" initial={false} animate={{ scaleX: Math.max(pct, 4) / 100 }} transition={T.fill} />
        </span>
        <p className="mt-1.5 truncate text-xs text-muted-foreground">{complete ? "Every step is done." : current.hint}</p>
        {step === "story" && <CaptionRunPill />}
      </div>

      {/* Tablet and up: all four steps in one slim row. */}
      <div className="hidden min-h-14 items-center gap-4 md:flex">
        <ol className="flex min-w-0 flex-1 items-center">
          {items.map((s, i) => {
            const on = s.state === "current";
            const done = s.state === "done";
            return (
              <li key={s.id} className={cn("flex min-w-0 items-center", i < items.length - 1 && "flex-1")}>
                <button
                  type="button"
                  onClick={() => press(s)}
                  aria-current={on ? "step" : undefined}
                  aria-disabled={!s.canGo || undefined}
                  aria-describedby={why && !s.canGo && !on ? whyId : undefined}
                  title={s.canGo ? `Go to ${s.label}` : !on && !complete ? (blocked?.[s.id] ?? undefined) : undefined}
                  className={cn(
                    "group flex min-h-11 min-w-0 shrink items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-left outline-none transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                    s.canGo ? "cursor-pointer [@media(hover:hover)]:hover:bg-secondary/70" : on ? "cursor-default" : "cursor-not-allowed",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors duration-200 motion-reduce:transition-none",
                      // 1212: lime for the step you are on, deep green with a check once it is done, a quiet lock until it opens.
                      on ? "lime-bg ring-2 ring-[hsl(var(--lime)/0.35)]" : done ? "bg-[#173A24] text-white" : "bg-secondary text-muted-foreground hairline",
                    )}
                    aria-hidden="true"
                  >
                    {done ? <Check className="h-3 w-3" strokeWidth={3} /> : s.state === "blocked" ? <Lock className="h-2.5 w-2.5" /> : s.n}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block truncate text-[13px] font-semibold leading-tight tracking-[-0.01em]", on ? "text-foreground" : "text-muted-foreground")}>
                      <span className="sr-only">Step {s.i + 1}: </span>
                      {s.label}
                    </span>
                    <span className={cn("hidden truncate text-xs leading-tight lg:block", on ? "text-muted-foreground" : "text-muted-foreground/80")}>
                      {done ? "Done" : s.hint}
                    </span>
                    <span className="sr-only">{done ? ", done" : on ? ", current step" : s.state === "blocked" ? ", not available yet" : ""}</span>
                  </span>
                </button>
                {i < items.length - 1 && (
                  <span className="relative mx-1.5 h-px min-w-3 flex-1 bg-border lg:mx-2.5" aria-hidden="true">
                    <motion.span className="absolute inset-0 origin-left bg-[#173A24]/70" initial={false} animate={{ scaleX: done || complete ? 1 : 0 }} transition={T.fill} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {step === "story" && <CaptionRunPill className="mt-0 hidden shrink-0 lg:inline-flex" />}
        {trailing && <div className="hidden shrink-0 items-center gap-1 xl:flex">{trailing}</div>}
      </div>
      <p id={whyId} role="status" aria-live="polite" className={cn("text-xs text-muted-foreground", why ? "mt-1" : "sr-only")}>
        {why ?? ""}
      </p>
    </nav>
  );
}
