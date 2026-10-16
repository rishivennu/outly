import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Clock, Eye, Send, Trophy } from "lucide-react";
import type { Pulse } from "@/lib/retention/pulse";
import { compact } from "@/lib/retention/pulse-core";
import { cn } from "@/lib/utils";

/**
 * Home "This week": the three numbers a creator checks first (views, posts out, the next good slot),
 * a Monday-to-Sunday strip of what went out and what's lined up, and this week's top post.
 */
export function WeekPulse({ p }: { p: Pulse }) {
  const up = (p.viewsChange ?? 0) >= 0;
  return (
    <section aria-labelledby="pulse-h" className="glass min-w-0 rounded-[32px] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="pulse-h" className="eyebrow flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> This week</h2>
        <Link href="/analytics" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
          Full analytics <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      <dl className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-secondary/60 p-4">
          <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Eye className="h-3.5 w-3.5" aria-hidden="true" /> Views, last 7 days</dt>
          <dd className="mt-1.5 flex flex-wrap items-baseline gap-2">
            <span className="display text-3xl tabular-nums">{compact(p.views)}</span>
            {p.viewsChange !== null && (
              <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold", up ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive")}>
                {up ? <ArrowUpRight className="h-3 w-3" aria-hidden="true" /> : <ArrowDownRight className="h-3 w-3" aria-hidden="true" />}
                {up ? "+" : ""}{p.viewsChange}% vs last week
              </span>
            )}
          </dd>
        </div>
        <div className="rounded-2xl bg-secondary/60 p-4">
          <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Send className="h-3.5 w-3.5" aria-hidden="true" /> Posts out</dt>
          <dd className="mt-1.5 flex items-baseline gap-2">
            <span className="display text-3xl tabular-nums">{p.postsOut}</span>
            <span className="text-sm text-muted-foreground">since Monday</span>
          </dd>
        </div>
        <div className="rounded-2xl bg-secondary/60 p-4">
          <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Clock className="h-3.5 w-3.5" aria-hidden="true" /> Next good time to post</dt>
          <dd className="mt-1.5">
            {p.best ? (
              <>
                <span className="display block text-2xl">{p.best.label}</span>
                <span className="text-xs text-muted-foreground">{p.best.source === "yours" ? "From when your posts did best" : "Typical peak for your platforms"}</span>
                <Link href="/create" className="mt-1 flex min-h-[44px] items-center gap-1 text-sm font-semibold hover:underline">
                  Plan one for then <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Connect a platform and we&apos;ll suggest one.</span>
            )}
          </dd>
        </div>
      </dl>

      <Link href="/calendar" aria-label="Open your calendar" className="mt-4 grid grid-cols-7 gap-1.5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {p.strip.map((d) => {
          const dots = d.published + d.scheduled;
          return (
            <span
              key={d.key}
              className={cn("flex min-h-[76px] flex-col items-center gap-1 rounded-2xl px-1 py-2.5 transition hover:bg-secondary", d.isToday ? "bg-foreground text-background hover:bg-foreground" : "bg-secondary/40")}
              aria-label={`${d.label} ${d.date}: ${d.published} out, ${d.scheduled} scheduled`}
            >
              <span className={cn("text-[11px] font-medium", d.isToday ? "text-background/75" : "text-muted-foreground")}>{d.label}</span>
              <span className="text-sm font-semibold tabular-nums">{d.date}</span>
              <span className="flex h-2 items-center gap-0.5" aria-hidden="true">
                {Array.from({ length: Math.min(3, d.published) }, (_, i) => <i key={`p${i}`} className={cn("block h-1.5 w-1.5 rounded-full", d.isToday ? "bg-[hsl(var(--lime))]" : "bg-success")} />)}
                {Array.from({ length: Math.min(3 - Math.min(3, d.published), d.scheduled) }, (_, i) => <i key={`s${i}`} className={cn("block h-1.5 w-1.5 rounded-full border", d.isToday ? "border-background/80" : "border-foreground/50")} />)}
                {dots === 0 && <i className={cn("block h-1 w-1 rounded-full", d.isToday ? "bg-background/30" : "bg-foreground/15")} />}
              </span>
            </span>
          );
        })}
      </Link>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><i className="block h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" /> Went out</span>
        <span className="inline-flex items-center gap-1.5"><i className="block h-1.5 w-1.5 rounded-full border border-foreground/50" aria-hidden="true" /> Scheduled</span>
      </p>

      {p.top && p.top.views > 0 && (
        <Link href="/analytics" className="mt-3 flex min-h-[44px] items-center gap-3 rounded-2xl bg-secondary/60 px-4 py-2.5 text-sm transition hover:bg-secondary">
          <Trophy className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate"><span className="text-muted-foreground">Top this week: </span><span className="font-semibold">{p.top.title}</span></span>
          <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs font-semibold tabular-nums hairline">{compact(p.top.views)} views</span>
        </Link>
      )}
    </section>
  );
}
