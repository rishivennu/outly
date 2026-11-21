"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */
import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SPRING_STEP } from "@/components/ui/easy/lib/motion-tokens";

const spring = SPRING_STEP;
const fill = { duration: 0.35, ease: [0.32, 0.72, 0, 1] } as const;
const still = { duration: 0 } as const;

export interface Step {
  label: string;
  hint?: string;
}

export interface StepperProps {
  steps: Step[];
  current: number;
  /** Makes completed steps clickable (jump back). */
  onStepChange?: (index: number) => void;
  orientation?: "horizontal" | "vertical";
  /** Below md, hide every label (the caller shows its own "Step n of N" line). */
  compact?: boolean;
  "aria-label"?: string;
  className?: string;
}

export function Stepper({ steps, current, onStepChange, orientation = "horizontal", compact = false, "aria-label": ariaLabel = "Progress", className }: StepperProps) {
  const uid = React.useId();
  const calm = useReducedMotion();
  const vertical = orientation === "vertical";
  const last = steps.length - 1;

  // don't replay the check-draw for steps that are already done on first paint (a restored draft)
  const ready = React.useRef(false);
  React.useEffect(() => {
    ready.current = true;
  }, []);

  return (
    <ol aria-label={ariaLabel} className={cn(vertical ? "flex flex-col" : "flex w-full items-center", className)}>
      {steps.map((step, i) => {
        const state = i < current ? "complete" : i === current ? "current" : "upcoming";
        const clickable = !!onStepChange && state === "complete";

        const indicator = (
          <span
            data-state={state}
            className={cn(
              "relative grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums transition-colors duration-300",
              state === "complete" && "border-lime-ink bg-lime-ink text-background",
              state === "current" && "border-lime-ink text-foreground",
              state === "upcoming" && "border-foreground/[0.14] text-muted-foreground",
            )}
          >
            {state === "current" && (
              <motion.span layoutId={`${uid}-ring`} transition={calm ? still : spring} aria-hidden="true" className="absolute -inset-[5px] rounded-full border border-lime-ink/45" />
            )}
            {state === "complete" ? (
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <motion.path
                  d="M5 12.5l4.5 4.5L19 7.5"
                  initial={ready.current && !calm ? { pathLength: 0 } : false}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.3, delay: 0.08, ease: "easeOut" }}
                />
              </svg>
            ) : (
              <span aria-hidden="true">{i + 1}</span>
            )}
          </span>
        );

        const label = (
          <span className={cn("flex min-w-0 flex-col text-left", !vertical && (compact ? "hidden md:flex" : state !== "current" && "hidden sm:flex"))}>
            <span className={cn("truncate text-[13px] leading-tight transition-colors duration-300", state === "upcoming" ? "text-muted-foreground" : "font-semibold text-foreground")}>
              {step.label}
            </span>
            {step.hint && <span className="truncate text-xs text-muted-foreground">{step.hint}</span>}
          </span>
        );

        const sr = (
          <span className="sr-only">
            Step {i + 1} of {steps.length}: {step.label}
            {state === "complete" ? ", completed" : state === "current" ? ", current step" : ""}
          </span>
        );

        const row = clickable ? (
          <button
            type="button"
            onClick={() => onStepChange!(i)}
            className={cn(
              "flex min-h-11 min-w-11 shrink gap-2.5 overflow-hidden rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-card",
              vertical ? "items-start" : "items-center",
            )}
          >
            {indicator}
            <span aria-hidden="true" className="contents">{label}</span>
            {sr}
          </button>
        ) : (
          <div className={cn("flex min-h-11 min-w-0 gap-2.5", vertical ? "items-start" : "items-center")}>
            {indicator}
            <span aria-hidden="true" className="contents">{label}</span>
            {sr}
          </div>
        );

        return (
          <li
            key={step.label}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(vertical ? "relative pb-7 last:pb-0" : "flex min-w-0 items-center", !vertical && i < last && "flex-1")}
          >
            {row}
            {i < last && (
              <span
                aria-hidden="true"
                className={cn("overflow-hidden bg-foreground/[0.08]", vertical ? "absolute bottom-1 left-[13.5px] top-[34px] w-px" : "relative mx-2 h-0.5 min-w-2 flex-1 rounded-full sm:mx-3")}
              >
                <motion.span
                  initial={false}
                  animate={vertical ? { scaleY: i < current ? 1 : 0 } : { scaleX: i < current ? 1 : 0 }}
                  transition={calm ? still : fill}
                  className={cn("absolute inset-0 bg-lime-ink", vertical ? "origin-top" : "origin-left")}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export interface StepPanelsProps {
  current: number;
  /**
   * One child per step, in order. Falsy slots keep their place (`{step === 0 && ...}` works), so the
   * index always matches the step.
   */
  children: React.ReactNode;
  className?: string;
}

/**
 * The step body slides in from the side you are travelling towards. Enter only, no exit: the new step is in
 * the DOM at once, so focusing its first invalid field in the next frame still finds it.
 */
export function StepPanels({ current, children, className }: StepPanelsProps) {
  const calm = useReducedMotion();
  const list = Array.isArray(children) ? children : [children];
  const prev = React.useRef(current);
  const first = React.useRef(true);
  const dir = current >= prev.current ? 1 : -1;
  React.useEffect(() => {
    prev.current = current;
    first.current = false;
  }, [current]);

  return (
    <div className={className}>
      <motion.div
        key={current}
        initial={first.current || calm ? false : { x: dir * 16, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      >
        {list[current]}
      </motion.div>
    </div>
  );
}
