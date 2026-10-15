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
/** Words for the tone, so urgency never rides on colour alone. */
const TAG: Record<Step["tone"], string> = { danger: "Needs a fix", warn: "Heads up", info: "Up next", good: "Quick win" };

/**
 * "What to do next" (10-15 redesign): the most urgent step as a big featured tile with its own button,
 * the rest as numbered tiles underneath. Server-rendered, no JS needed.
 */
export function NextSteps({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  const [top, ...rest] = steps;
  const TopIcon = ICON[top.kind];
  return (
    <section aria-labelledby="next-h" className="glass flex h-full min-w-0 flex-col rounded-[32px] p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="next-h" className="eyebrow">What to do next</h2>
        <span className="text-[13px] text-muted-foreground tabular">{steps.length === 1 ? "1 thing" : `${steps.length} things`}</span>
      </div>

      <Link href={top.href} className="group relative flex flex-col gap-4 overflow-hidden rounded-[24px] bg-secondary/60 p-4 hairline transition-colors hover:bg-secondary sm:flex-row sm:items-center sm:p-5 md:min-h-[200px] md:flex-1 md:flex-col md:items-start md:p-6">
        <TopIcon className="pointer-events-none absolute -bottom-8 -right-6 hidden h-44 w-44 rotate-[-12deg] opacity-[0.06] md:block" aria-hidden="true" />
        <span className={cn("grid h-14 w-14 shrink-0 place-items-center rounded-[18px]", TONE[top.tone])}>
          <TopIcon className="h-6 w-6" aria-hidden="true" />
        </span>
        <span className="relative min-w-0 flex-1 md:flex-none">
          <span className={cn("mb-1 inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold", TONE[top.tone])}>{TAG[top.tone]}</span>
          <span className="block text-lg font-semibold leading-snug md:text-xl">{top.title}</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{top.body}</span>
        </span>
        <span className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 self-start rounded-full bg-foreground px-4 text-sm font-semibold text-background transition-transform group-hover:translate-x-0.5 sm:self-center md:relative md:mt-auto md:self-start">
          {top.action}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </Link>

      {rest.length > 0 && (
        <ol className={cn("mt-3 grid gap-2", rest.length > 1 && "sm:grid-cols-2")} start={2}>
          {rest.map((s, i) => {
            const Icon = ICON[s.kind];
            return (
              <li key={`${s.kind}-${i}`} className="min-w-0">
                <Link href={s.href} className="group flex h-full min-h-[64px] items-start gap-3 rounded-2xl p-3 hairline transition-colors hover:bg-secondary focus-visible:bg-secondary">
                  <span className="relative shrink-0">
                    <span className={cn("grid h-10 w-10 place-items-center rounded-xl", TONE[s.tone])}>
                      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <span className="absolute -left-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-foreground text-[11px] font-semibold text-background tabular" aria-hidden="true">{i + 2}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-snug">{s.title}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-[13px] font-medium text-muted-foreground group-hover:text-foreground">
                      {s.action} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                    {s.tone === "danger" && <span className="sr-only">Needs a fix.</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
