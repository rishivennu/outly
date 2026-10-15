import Link from "next/link";
import { AlertTriangle, ArrowRight, CircleAlert, Lightbulb, Link2, Repeat2, Rocket, PenLine, Target, CalendarPlus } from "lucide-react";
import type { Step, StepKind } from "@/lib/retention/core";
import { cn } from "@/lib/utils";

const ICON: Record<StepKind, typeof ArrowRight> = {
  failed: AlertTriangle,
  reconnect: Link2,
  expiring: CircleAlert,
  connect: Link2,
  first_post: Rocket,
  draft: PenLine,
  goal: Target,
  schedule: CalendarPlus,
  idea: Lightbulb,
  recycle: Repeat2,
};

const TONE: Record<Step["tone"], string> = {
  danger: "bg-destructive/12 text-destructive",
  warn: "bg-warning/15 text-warning",
  info: "bg-secondary text-foreground",
  good: "bg-lime/20 text-lime-ink",
};

/** "What to do next": the most urgent one to three things, broken things first. Server-rendered, no JS needed. */
export function NextSteps({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <section aria-labelledby="next-h" className="glass min-w-0 rounded-[32px] p-5 sm:p-6">
      <h2 id="next-h" className="eyebrow mb-4">What to do next</h2>
      <ol className="flex flex-col gap-2">
        {steps.map((s, i) => {
          const Icon = ICON[s.kind];
          return (
            <li key={`${s.kind}-${i}`}>
              <Link href={s.href} className="group flex min-h-[64px] items-center gap-4 rounded-2xl p-3 transition-colors hover:bg-secondary focus-visible:bg-secondary">
                <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", TONE[s.tone])}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-snug">{s.title}</span>
                  <span className="block text-sm text-muted-foreground">{s.body}</span>
                </span>
                <span className="hidden shrink-0 items-center gap-1.5 text-sm font-medium text-foreground sm:flex">
                  {s.action}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden" aria-hidden="true" />
                {i === 0 && s.tone === "danger" && <span className="sr-only">Urgent.</span>}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
