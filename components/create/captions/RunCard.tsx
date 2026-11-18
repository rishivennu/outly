"use client";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * R1178: the run card for a caption job in progress (transcribe, translate, burn). One dark spotlight card in
 * place of the old hairline bar: what is running, how far it is, which step is live, and Stop. Ink in both themes
 * on purpose (it is the one thing moving on the page), lime fill for progress, no colour-only meaning: every step
 * has a text label and a state word for screen readers.
 */
export type RunStep = { label: string; state: "done" | "active" | "next" };

export function RunCard({ title, chip, percent, detail, steps, onStop, stopLabel = "Stop", compact, className }: {
  title: string;
  /** Short context next to the title: the language, the file, the caption style. */
  chip?: string;
  /** 0 to 100, or null while the amount of work is still unknown (indeterminate). */
  percent: number | null;
  /** Trailing chip inside the bar: "3 of 6 parts", "About a minute". */
  detail?: string;
  steps: RunStep[];
  onStop?: () => void;
  stopLabel?: string;
  /** R1193: the short form for the video column: one header row, the bar, and the steps for screen readers only. */
  compact?: boolean;
  className?: string;
}) {
  const p = percent == null ? null : Math.max(0, Math.min(100, Math.round(percent)));
  const live = steps.find((s) => s.state === "active");
  const valueText = p == null ? `${live?.label ?? "Working"}, amount not known yet` : `${p} percent${detail ? `, ${detail}` : ""}`;
  if (compact)
    return (
      <section aria-label={title} className={cn("run-card relative overflow-hidden rounded-[22px] bg-[hsl(240_6%_9%)] p-4 text-[hsl(40_33%_95%)] shadow-[0_24px_60px_-28px_rgba(0,0,0,.55)]", className)}>
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-lime motion-reduce:animate-none" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold leading-tight">{title}</h3>
            {chip && <p className="mt-0.5 truncate text-[12.5px] text-white/65">{chip}</p>}
          </div>
          {p != null && (
            <span className="shrink-0 font-display text-[22px] font-semibold leading-none tabular-nums" aria-hidden="true">
              {p}
              <span className="text-white/45">%</span>
            </span>
          )}
          {onStop && (
            <Button type="button" variant="ghost" size="icon" onClick={onStop} aria-label={`${stopLabel} ${title.toLowerCase()}`} title={stopLabel} className="h-11 w-11 shrink-0 rounded-full bg-white/10 text-white ring-1 ring-inset ring-white/25 hover:bg-white/15 hover:text-white">
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <div role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p ?? undefined} aria-valuetext={valueText} className="relative mt-3 flex h-9 items-center overflow-hidden rounded-full bg-white/10">
          <span
            className={cn("run-fill absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,hsl(var(--lime)),hsl(84_95%_47%))] transition-[width] duration-500 ease-out motion-reduce:transition-none", p == null && "run-fill-wait")}
            style={{ width: p == null ? "38%" : `${Math.max(p, 4)}%` }}
            aria-hidden="true"
          />
          {detail && <span className="relative ml-auto mr-1 inline-flex h-7 items-center rounded-full bg-white/10 px-2.5 text-[12.5px] font-medium text-white/85 backdrop-blur">{detail}</span>}
        </div>
        <ol className="sr-only">
          {steps.map((s) => (
            <li key={s.label}>
              {s.label}, {s.state === "done" ? "done" : s.state === "active" ? "in progress" : "next"}
            </li>
          ))}
        </ol>
      </section>
    );
  return (
    <section
      aria-label={title}
      className={cn("run-card relative overflow-hidden rounded-[28px] bg-[hsl(240_6%_9%)] p-5 text-[hsl(40_33%_95%)] shadow-[0_24px_60px_-28px_rgba(0,0,0,.55)] sm:p-6", className)}
    >
      <Loader2 className="h-5 w-5 animate-spin text-lime motion-reduce:animate-none" aria-hidden="true" />
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.01em]">{title}</h3>
        {chip && <span className="inline-flex min-h-8 items-center rounded-full border border-white/20 px-3 text-[13.5px] text-white/80">{chip}</span>}
      </div>
      <p className="mt-2 font-display text-[44px] font-semibold leading-none tabular-nums tracking-[-0.02em]" aria-hidden="true">
        {p == null ? <span className="text-[22px] font-medium text-white/70">{live?.label ?? "Working"}</span> : <>{p}<span className="text-white/45">%</span></>}
      </p>
      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p ?? undefined}
        aria-valuetext={valueText}
        className="relative mt-4 flex h-12 items-center overflow-hidden rounded-full bg-white/10"
      >
        <span
          className={cn("run-fill absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,hsl(var(--lime)),hsl(84_95%_47%))] shadow-[0_0_24px_-4px_hsl(var(--lime)/.7)] transition-[width] duration-500 ease-out motion-reduce:transition-none", p == null && "run-fill-wait")}
          style={{ width: p == null ? "38%" : `${Math.max(p, 4)}%` }}
          aria-hidden="true"
        />
        {detail && <span className="relative ml-auto mr-1.5 inline-flex h-9 items-center rounded-full bg-white/10 px-3.5 text-[14px] font-medium text-white/85 backdrop-blur">{detail}</span>}
      </div>
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[14px] text-white/60">Steps <span className="text-white/85">{steps.length}</span></p>
          <ol className="mt-2 flex flex-wrap gap-2">
            {steps.map((s) => (
              <li
                key={s.label}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 text-[13.5px]",
                  s.state === "done" && "border-white/15 text-white/70",
                  s.state === "active" && "border-lime/70 bg-lime/10 text-white",
                  s.state === "next" && "border-white/10 text-white/45",
                )}
                aria-current={s.state === "active" ? "step" : undefined}
              >
                {s.state === "done" ? <Check className="h-3.5 w-3.5 text-lime" aria-hidden="true" /> : s.state === "active" ? <span className="h-2 w-2 rounded-full bg-lime" aria-hidden="true" /> : <span className="h-2 w-2 rounded-full border border-white/30" aria-hidden="true" />}
                {s.label}
                <span className="sr-only">{s.state === "done" ? ", done" : s.state === "active" ? ", in progress" : ", next"}</span>
              </li>
            ))}
          </ol>
        </div>
        {onStop && (
          <Button type="button" variant="ghost" onClick={onStop} className="min-h-11 shrink-0 self-start rounded-full bg-white/10 text-white ring-1 ring-inset ring-white/25 hover:bg-white/15 hover:text-white sm:self-auto">
            <X className="h-4 w-4" aria-hidden="true" /> {stopLabel}
          </Button>
        )}
      </div>
    </section>
  );
}

/** The three caption steps as the run store reports them. */
export function transcribeSteps(busy: { kind: "transcribe"; done: number; total: number }): RunStep[] {
  const extracting = busy.total === 0;
  return [
    { label: "Audio", state: extracting ? "active" : "done" },
    { label: "Transcribe", state: extracting ? "next" : "active" },
    { label: "Captions", state: "next" },
  ];
}
