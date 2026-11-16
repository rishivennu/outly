"use client";
import { useId } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clampSize, saySize, showSize, SIZE_BASE, SIZE_MAX, SIZE_MIN, SIZE_STEP, stepSize } from "@/lib/captions/size";

const btn =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl text-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.96] motion-reduce:transition-none [@media(hover:hover)]:hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-40 disabled:active:scale-100";

/** One size for every caption line, 60% to 160% in 10% steps. The preview shows the exact size that burns in. */
export function CaptionSize({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const id = useId();
  const v = clampSize(value);
  return (
    <div role="group" aria-labelledby={`${id}-l`} aria-describedby={`${id}-d`} className="mt-5 rounded-2xl bg-secondary/40 p-3 hairline sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <p id={`${id}-l`} className="min-w-0 text-[13px] font-semibold">Caption size</p>
        <div className="flex shrink-0 items-center gap-1">
          <output htmlFor={`${id}-r`} className={cn("min-w-[52px] text-right text-[13px] font-semibold tabular-nums", v === SIZE_BASE && "text-muted-foreground")}>{showSize(v)}</output>
          <Button type="button" variant="ghost" className="min-h-11 px-3" onClick={() => onChange(SIZE_BASE)} disabled={disabled || v === SIZE_BASE} aria-label="Reset the caption size">
            <RotateCcw className="h-4 w-4" aria-hidden /> Reset
          </Button>
        </div>
      </div>
      <p id={`${id}-d`} className="mt-0.5 text-[12px] text-muted-foreground">Poppins Bold with tight letter spacing. The preview shows the size that goes into the video; bigger text wraps onto more lines.</p>
      <div className="mt-2 flex min-w-0 items-center gap-1">
        <button type="button" className={btn} onClick={() => onChange(stepSize(v, -1))} disabled={disabled || v <= SIZE_MIN} aria-label="Smaller captions">
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <input
          id={`${id}-r`}
          type="range"
          min={SIZE_MIN}
          max={SIZE_MAX}
          step={SIZE_STEP}
          value={v}
          disabled={disabled}
          onChange={(e) => onChange(clampSize(e.target.value))}
          aria-label="Caption size"
          aria-valuetext={saySize(v)}
          className="h-11 min-w-0 flex-1 cursor-pointer accent-[#173A24] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:accent-[#B5FF00]"
        />
        <button type="button" className={btn} onClick={() => onChange(stepSize(v, 1))} disabled={disabled || v >= SIZE_MAX} aria-label="Bigger captions">
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
