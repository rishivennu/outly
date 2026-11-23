import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LEVEL_LABEL, fmtWhen, seatsLabel, type WorkshopView } from "@/lib/workshops/core";
import { cn } from "@/lib/utils";
import s from "./workshops.module.css";

const TINTS = [s.sun, s.pink, s.sky, s.mint];
export const tintFor = (i: number) => cn(s.tint, TINTS[i % TINTS.length]);

export const isFull = (w: Pick<WorkshopView, "capacity" | "seatsLeft">) => w.capacity > 0 && (w.seatsLeft ?? 0) <= 0;

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Pastel "Round up" card: mono date label, chunky title, "with host", white pill. The whole card is the link. */
export function WorkshopCard({ w, index = 0 }: { w: WorkshopView; index?: number }) {
  const when = fmtWhen(w.startsAt, w.endsAt, w.timezone);
  const full = isFull(w);
  const cta = w.live ? "Join live" : full ? "See details" : "Save a seat";
  return (
    <Link
      href={`/workshops/${w.slug}`}
      className={cn(
        "group relative flex h-full min-h-[21rem] flex-col rounded-[1.6rem] border border-foreground/10 p-6 text-foreground transition-transform duration-card hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-7",
        tintFor(index),
        FOCUS,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={cn(s.mono, "text-[11px] font-bold uppercase tracking-[0.18em] text-foreground/80")}>
          <span className="sr-only">When: </span>
          {when.weekday.slice(0, 3)} · {when.dayNum} {when.month} · {when.time.split(" – ")[0]}
        </p>
        {w.live ? (
          <span className="inline-flex min-h-7 items-center gap-2 rounded-full bg-foreground px-3 text-[11px] font-bold uppercase tracking-wider text-background">
            <span className="live-dot" aria-hidden="true" />
            Live
          </span>
        ) : full ? (
          <span className="inline-flex min-h-7 items-center rounded-full border-[1.5px] border-foreground px-3 text-[11px] font-bold uppercase tracking-wider">Full</span>
        ) : null}
      </div>

      <h3 className={cn(s.chunky, "mt-6 text-balance text-[1.75rem] leading-[1.02] sm:text-[2rem]")}>{w.title}</h3>
      <p className={cn(s.serif, "mt-3 text-[1.15rem] leading-snug text-foreground/85")}>
        with {w.host || "the Outlly team"}
      </p>
      {w.summary && <p className="mt-3 line-clamp-2 text-[14px] leading-relaxed text-foreground/75">{w.summary}</p>}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-7">
        <span className={cn(s.whiteBtn, "inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[14px] font-bold transition group-hover:border-foreground/40")}>
          {cta}
          <ArrowRight size={16} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </span>
        <span className={cn(s.mono, "text-[11px] uppercase tracking-[0.14em] text-foreground/70")}>
          {LEVEL_LABEL[w.level]} · {seatsLabel(w)}
        </span>
      </div>
    </Link>
  );
}
