import Link from "next/link";
import { ArrowUpRight, Clock, Users } from "lucide-react";
import { LEVEL_LABEL, fmtWhen, seatsLabel, type WorkshopView } from "@/lib/workshops/core";
import { cn } from "@/lib/utils";
import s from "./workshops.module.css";

const TINTS = [s.sun, s.pink, s.sky, s.lime];
export const tintFor = (i: number) => cn(s.tint, TINTS[i % TINTS.length]);

export const isFull = (w: Pick<WorkshopView, "capacity" | "seatsLeft">) => w.capacity > 0 && (w.seatsLeft ?? 0) <= 0;

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function WorkshopCard({ w, index = 0 }: { w: WorkshopView; index?: number }) {
  const when = fmtWhen(w.startsAt, w.endsAt, w.timezone);
  const full = isFull(w);
  return (
    <Link
      href={`/workshops/${w.slug}`}
      className={cn(
        "group relative flex h-full flex-col rounded-[1.5rem] border border-foreground/10 p-5 text-foreground transition-transform duration-card hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-6",
        tintFor(index),
        FOCUS,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex w-16 shrink-0 flex-col items-center rounded-2xl border-2 border-foreground bg-background py-2 leading-none" aria-hidden="true">
          <span className="font-display text-[11px] font-extrabold tracking-[0.18em]">{when.month}</span>
          <span className="mt-1 font-display text-3xl font-extrabold tabular-nums">{when.dayNum}</span>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {w.live && (
            <span className="inline-flex min-h-7 items-center gap-2 rounded-full bg-foreground px-3 text-xs font-semibold text-background">
              <span className="live-dot" aria-hidden="true" />
              Live now
            </span>
          )}
          {full && !w.live && <span className="inline-flex min-h-7 items-center rounded-full border-2 border-foreground px-3 text-xs font-bold uppercase tracking-wider">Full</span>}
          <span className="inline-flex min-h-7 items-center rounded-full bg-background/70 px-3 text-xs font-medium">{LEVEL_LABEL[w.level]}</span>
        </div>
      </div>
      <p className="mt-5 text-[13px] font-medium text-foreground/75">
        <span className="sr-only">When: </span>
        {when.weekday}, {when.time}
      </p>
      <h3 className="mt-1.5 font-display text-xl font-extrabold leading-tight tracking-tight sm:text-[1.4rem]">{w.title}</h3>
      {w.summary && <p className="mt-2 line-clamp-3 text-[15px] leading-relaxed text-foreground/80">{w.summary}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-5 text-[13px] text-foreground/75">
        {w.host && <span className="font-medium text-foreground">with {w.host}</span>}
        <span className="inline-flex items-center gap-1.5">
          <Clock size={14} aria-hidden="true" />
          {when.dur}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users size={14} aria-hidden="true" />
          {seatsLabel(w)}
        </span>
        <ArrowUpRight size={18} aria-hidden="true" className="ml-auto transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none" />
      </div>
    </Link>
  );
}
