"use client";
import { useId } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clampOffset, MAX_OFFSET, OFFSET_STEP, sayOffset, showOffset, stepOffset } from "@/lib/captions/offset";

const btn =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl text-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.96] motion-reduce:transition-none [@media(hover:hover)]:hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-40 disabled:active:scale-100";

/** One shift for every line on both tracks, -2.0 to +2.0 s in 0.1 s steps. Arrow keys move the slider. */
export function CaptionShift({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const id = useId();
  const v = clampOffset(value);
  return (
    <div role="group" aria-labelledby={`${id}-l`} aria-describedby={`${id}-d`} className="mt-5 rounded-2xl bg-secondary/40 p-3 hairline sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <p id={`${id}-l`} className="min-w-0 text-[13px] font-semibold">Shift all captions</p>
        <div className="flex shrink-0 items-center gap-1">
          <output htmlFor={`${id}-r`} className={cn("min-w-[52px] text-right text-[13px] font-semibold tabular-nums", !v && "text-muted-foreground")}>{showOffset(v)}</output>
          <Button type="button" variant="ghost" className="min-h-11 px-3" onClick={() => onChange(0)} disabled={disabled || !v} aria-label="Reset the caption shift">
            <RotateCcw className="h-4 w-4" aria-hidden /> Reset
          </Button>
        </div>
      </div>
      <p id={`${id}-d`} className="mt-0.5 text-[12px] text-muted-foreground">AI timings are estimates. If every line shows early or late, move them all here. Both tracks move, and your line times stay as they are.</p>
      <div className="mt-2 flex min-w-0 items-center gap-1">
        <button type="button" className={btn} onClick={() => onChange(stepOffset(v, -1))} disabled={disabled || v <= -MAX_OFFSET} aria-label="Show captions 0.1 seconds earlier">
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <input
          id={`${id}-r`}
          type="range"
          min={-MAX_OFFSET}
          max={MAX_OFFSET}
          step={OFFSET_STEP}
          value={v}
          disabled={disabled}
          onChange={(e) => onChange(clampOffset(e.target.value))}
          aria-label="Shift all captions"
          aria-valuetext={sayOffset(v)}
          className="h-11 min-w-0 flex-1 cursor-pointer accent-[#173A24] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:accent-[#B5FF00]"
        />
        <button type="button" className={btn} onClick={() => onChange(stepOffset(v, 1))} disabled={disabled || v >= MAX_OFFSET} aria-label="Show captions 0.1 seconds later">
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
