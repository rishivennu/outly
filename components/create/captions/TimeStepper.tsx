"use client";
import { useEffect, useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { NUDGE, parseTimeInput, showSeconds } from "@/lib/captions/edit";

interface Props {
  label: string;
  /** Spoken name, e.g. "Caption 2 start". */
  name: string;
  value: number;
  min: number;
  max: number;
  /** Returns an error to show, or null when the value was taken (possibly clamped). */
  onCommit: (seconds: number) => string | null;
  onNudge: (delta: number) => void;
}

const btn =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl text-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.96] motion-reduce:transition-none [@media(hover:hover)]:hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-40 disabled:active:scale-100";

/** One edge of a caption: a seconds box with 0.1 s nudges either side. Arrow keys nudge too (Shift: 1 s). */
export function TimeStepper({ label, name, value, min, max, onCommit, onNudge }: Props) {
  const id = useId();
  const [text, setText] = useState(showSeconds(value));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!editing) setText(showSeconds(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (text.trim() === showSeconds(value)) return setError(null);
    const s = parseTimeInput(text);
    const err = onCommit(s);
    setError(err);
    if (err) setText(showSeconds(value));
  };
  const range = `From ${showSeconds(min)} to ${Number.isFinite(max) ? showSeconds(max) : "the end"} seconds.`;

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[12px] font-medium text-muted-foreground">{label} <span className="sr-only">{range}</span></label>
      <div className="flex items-center gap-1 rounded-2xl bg-background/70 p-0.5 hairline">
        <button type="button" className={btn} onClick={() => onNudge(-NUDGE)} disabled={value <= min + 0.004} aria-label={`${name} 0.1 seconds earlier`}>
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          aria-label={`${name}, seconds`}
          onFocus={() => setEditing(true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.preventDefault(), e.currentTarget.blur());
            else if (e.key === "Escape") (e.preventDefault(), setText(showSeconds(value)), setError(null), setEditing(false));
            else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              setEditing(false);
              onNudge((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 1 : NUDGE));
            }
          }}
          className={cn("h-11 min-w-0 flex-1 rounded-xl bg-transparent text-center text-[14px] font-semibold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1", error && "ring-1 ring-[hsl(0_72%_45%)]")}
        />
        <span className="-ml-1 pr-1 text-[12px] text-muted-foreground" aria-hidden>s</span>
        <button type="button" className={btn} onClick={() => onNudge(NUDGE)} disabled={value >= max - 0.004} aria-label={`${name} 0.1 seconds later`}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-[12px] text-[hsl(0_72%_38%)] dark:text-[hsl(0_90%_72%)]">{error}</p>}
    </div>
  );
}
