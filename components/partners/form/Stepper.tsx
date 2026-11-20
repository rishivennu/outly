"use client";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEPS } from "./draft";

/** Step names with progress bars. Steps already passed are buttons, so the creator can go back without losing anything. */
export function Stepper({ step, onGo }: { step: number; onGo: (i: number) => void }) {
  return (
    <nav aria-label="Application progress">
      <p className="mb-3 text-[13px] font-medium text-muted-foreground sm:hidden" aria-hidden="true">
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </p>
      <ol className="grid grid-cols-5 gap-1.5 sm:gap-3">
        {STEPS.map((name, i) => {
          const done = i < step;
          const current = i === step;
          const inner = (
            <>
              <span aria-hidden="true" className={cn("block h-1 w-full rounded-full transition-colors", done || current ? "bg-lime-ink" : "bg-foreground/[0.08]")} />
              <span className={cn("mt-2 hidden items-center gap-1 text-[12px] leading-tight sm:flex", current ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {done && <Check className="h-3.5 w-3.5 shrink-0 text-lime-ink" aria-hidden="true" />}
                <span className="truncate">{name}</span>
              </span>
              <span className="sr-only">
                Step {i + 1} of {STEPS.length}: {name}
                {done ? ", completed" : current ? ", current step" : ""}
              </span>
            </>
          );
          return (
            <li key={name} aria-current={current ? "step" : undefined} className="min-w-0">
              {done ? (
                <button type="button" onClick={() => onGo(i)} className="flex min-h-11 w-full flex-col justify-center rounded-xl text-start focus-visible:outline-2 focus-visible:outline-offset-2">
                  {inner}
                </button>
              ) : (
                <div className="flex min-h-11 flex-col justify-center">{inner}</div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
