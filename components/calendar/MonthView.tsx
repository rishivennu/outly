"use client";
import { fmt } from "@/components/shell/UserContext";
import { cn } from "@/lib/utils";
import type { CalendarPost } from "@/lib/calendar/load";
import { PostCard } from "./PostCard";
import type { CardHandlers } from "./DayView";

const SHOWN = 3;
const keyDate = (key: string) => new Date(`${key}T12:00:00Z`);
const DOT = { draft: "bg-muted-foreground", scheduled: "bg-accent", publishing: "bg-accent", published: "bg-success", failed: "bg-destructive", attention: "bg-warning" } as const;

/**
 * A month grid, Monday first. On a phone each day is one tap target with a dot per post (open it to see them);
 * from sm up the first posts show as chips you can open or drag.
 */
export function MonthView({ days, month, today, byDay, onPickDay, dropFor, dragId, onDragStart, onDragEnd, ...h }: CardHandlers & {
  days: string[];
  month: string;
  today: string;
  byDay: Map<string, CalendarPost[]>;
  onPickDay: (key: string) => void;
  dropFor: (key: string, past: boolean) => React.HTMLAttributes<HTMLElement> & { "data-drop"?: boolean };
  dragId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 pb-2 text-center text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground" aria-hidden="true">
        {days.slice(0, 7).map((d) => (
          <span key={d}>{fmt(keyDate(d), "UTC", { weekday: "narrow" })}</span>
        ))}
      </div>
      <ol className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {days.map((d) => {
          const items = byDay.get(d) ?? [];
          const inMonth = d.slice(0, 7) === month;
          const isToday = d === today;
          const past = d < today;
          const { "data-drop": over, ...drop } = dropFor(d, past);
          const name = fmt(keyDate(d), "UTC", { weekday: "long", month: "long", day: "numeric" });
          return (
            <li key={d} {...drop} className={cn("relative flex min-h-16 flex-col rounded-2xl p-1 sm:min-h-[120px] sm:p-1.5", isToday ? "lime-ring bg-card/70" : "bg-card/40 hairline", !inMonth && "opacity-60", over && "ring-2 ring-[hsl(var(--lime))]")}>
              <button
                type="button"
                onClick={() => onPickDay(d)}
                aria-label={`${name}, ${items.length ? `${items.length} post${items.length === 1 ? "" : "s"}` : "nothing booked"}. Open the day.`}
                className="max-sm:absolute max-sm:inset-0 flex min-h-11 items-start justify-center rounded-2xl pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:justify-end sm:pt-0"
              >
                <span className={cn("tabular-nums grid h-7 w-7 place-items-center rounded-full text-xs font-semibold sm:text-sm", isToday && "lime-bg")}>{fmt(keyDate(d), "UTC", { day: "numeric" })}</span>
              </button>
              {items.length > 0 && (
                <span className="pointer-events-none mt-auto flex flex-wrap justify-center gap-0.5 pb-1 sm:hidden" aria-hidden="true">
                  {items.slice(0, 4).map((p) => (
                    <span key={p.id} className={cn("h-1.5 w-1.5 rounded-full", DOT[h.statusOf(p)])} />
                  ))}
                </span>
              )}
              <div className="mt-1 hidden flex-col gap-1 sm:flex">
                {items.slice(0, SHOWN).map((p) => (
                  <PostCard key={p.id} post={p} status={h.statusOf(p)} tz={h.tz} variant="chip" onOpen={h.onOpen} dragging={dragId === p.id} onDragStart={onDragStart} onDragEnd={onDragEnd} />
                ))}
                {items.length > SHOWN && (
                  <button type="button" onClick={() => onPickDay(d)} className="min-h-11 rounded-xl px-1.5 text-left text-xs font-medium text-muted-foreground transition-colors duration-200 [@media(hover:hover)]:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {items.length - SHOWN} more
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
