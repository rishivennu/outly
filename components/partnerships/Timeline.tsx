import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MineApplication } from "@/lib/partners/mine-types";
import { fmtDay } from "@/lib/partners/offer-core";
import { timelineStages, type Stage } from "./model";

function Dot({ s }: { s: Stage }) {
  if (s.state === "done")
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
      </span>
    );
  if (s.state === "current")
    return (
      <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-lime-ink bg-lime/15">
        <span className="h-2.5 w-2.5 rounded-full bg-lime-ink" aria-hidden="true" />
      </span>
    );
  if (s.state === "ended")
    return (
      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", s.key === "rejected" ? "bg-destructive/15 text-[hsl(0_72%_38%)] dark:text-destructive" : "bg-secondary text-muted-foreground")}>
        <X className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
      </span>
    );
  return <span className="h-7 w-7 shrink-0 rounded-full border-2 border-foreground/[0.14]" aria-hidden="true" />;
}

const STATE_SR: Record<Stage["state"], string> = { done: "Done", current: "Current step", future: "Not yet", ended: "Final status" };

export function Timeline({ app }: { app: Pick<MineApplication, "status" | "createdAt" | "events" | "decisionMessage" | "infoRequest"> }) {
  const stages = timelineStages(app);
  return (
    <ol aria-label="Application progress" className="flex flex-col" data-timeline="">
      {stages.map((s, i) => {
        const last = i === stages.length - 1;
        const live = s.state === "current" || s.state === "ended";
        return (
          <li key={s.key} data-stage={s.key} data-state={s.state} aria-current={live ? "step" : undefined} className="relative flex gap-4 pb-6 last:pb-0">
            {!last && <span aria-hidden="true" className={cn("absolute left-[13px] top-8 bottom-1 w-0.5 rounded-full", s.state === "done" ? "bg-primary/60" : "bg-foreground/[0.1]")} />}
            <Dot s={s} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className={cn("flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold leading-snug", s.state === "future" && "font-medium text-muted-foreground")}>
                <span>{s.label}</span>
                <span className="sr-only">({STATE_SR[s.state]})</span>
                {s.at && <span className="text-[12px] font-normal tabular-nums text-muted-foreground">{fmtDay(s.at)}</span>}
              </p>
              {live && <p className="mt-0.5 text-[14px] leading-relaxed text-muted-foreground">{s.copy}</p>}
              {s.note && <p className="mt-2 whitespace-pre-line rounded-2xl bg-secondary/60 px-4 py-3 text-[14px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{s.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
