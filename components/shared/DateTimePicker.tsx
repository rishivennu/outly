"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDaysKey, dayKey, fromTzParts, partsInTz } from "@/lib/client/tz";
import { tzShort } from "@/components/shell/UserContext";

interface Props {
  value: Date;
  onChange: (d: Date) => void;
  tz: string;
  /** Hours (0-23) where this creator's audience is most active. */
  peakHours?: number[];
}

const SLOTS = Array.from({ length: 48 }, (_, i) => ({ h: Math.floor(i / 2), m: (i % 2) * 30 }));

function label(h: number, m: number) {
  const ap = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}

export function DateTimePicker({ value, onChange, tz, peakHours = [] }: Props) {
  const now = new Date();
  const todayKey = dayKey(now, tz);
  const v = partsInTz(value, tz);
  const vKey = dayKey(value, tz);
  const slotsRef = useRef<HTMLDivElement>(null);

  const days = useMemo(
    () =>
      Array.from({ length: 21 }, (_, i) => {
        const key = addDaysKey(todayKey, i);
        const [y, m, d] = key.split("-").map(Number);
        const noon = fromTzParts(y, m, d, 12, 0, tz);
        return { key, y, m, d, wd: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(noon), mon: new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short" }).format(noon) };
      }),
    [todayKey, tz],
  );

  const set = (key: string, h: number, m: number) => {
    const [y, mo, d] = key.split("-").map(Number);
    onChange(fromTzParts(y, mo, d, h, m, tz));
  };

  const quick = useMemo(() => {
    const out: { label: string; key: string; h: number; m: number }[] = [];
    const n = partsInTz(now, tz);
    if (n.h < 19) out.push({ label: "Tonight, 8 PM", key: todayKey, h: 20, m: 0 });
    out.push({ label: "Tomorrow, 9 AM", key: addDaysKey(todayKey, 1), h: 9, m: 0 });
    out.push({ label: "Tomorrow, 8 PM", key: addDaysKey(todayKey, 1), h: 20, m: 0 });
    const sat = days.find((d, i) => i > 0 && d.wd === "Sat");
    if (sat) out.push({ label: "Saturday, 7 PM", key: sat.key, h: 19, m: 0 });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey, tz, days]);

  const isPast = (key: string, h: number, m: number) => {
    const [y, mo, d] = key.split("-").map(Number);
    return fromTzParts(y, mo, d, h, m, tz).getTime() < Date.now() + 60_000;
  };

  // Studio time is what the scheduler uses. If this device is somewhere else, say so once, quietly,
  // so 7 PM never means the wrong 7 PM.
  const [here, setHere] = useState<string | null>(null);
  useEffect(() => {
    try {
      setHere(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      /* keep quiet */
    }
  }, []);
  const elsewhere = here !== null && here !== tz;

  const headline = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long", day: "numeric" }).format(value);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">When should this go live?</p>
        <motion.p key={value.toISOString()} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} className="display mt-3 text-[clamp(2rem,4vw,2.8rem)]" aria-live="polite">
          {headline}
          <span className="block text-muted-foreground">
            {label(v.h, v.min)} {tzShort(tz)}
          </span>
        </motion.p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick picks">
        {quick.map((q) => {
          const on = vKey === q.key && v.h === q.h && v.min === q.m;
          return (
            <button key={q.label} type="button" onClick={() => set(q.key, q.h, q.m)} aria-pressed={on} className={cn("h-9 rounded-full px-3.5 text-[13px] font-medium transition", on ? "bg-foreground text-background" : "bg-secondary text-foreground/85 hover:bg-secondary/70 hairline")}>
              {q.label}
            </button>
          );
        })}
      </div>

      <div>
        <p className="mb-2 text-[13px] font-medium text-muted-foreground" id="dtp-day">Day</p>
        <div className="scrollbar-none -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1" role="group" aria-labelledby="dtp-day">
          {days.map((d, i) => {
            const on = d.key === vKey;
            return (
              <button
                key={d.key}
                type="button"
                aria-pressed={on}
                aria-label={`${d.wd} ${d.mon} ${d.d}`}
                onClick={() => {
                  const h = v.h, m = v.min;
                  set(d.key, h, m);
                  if (isPast(d.key, h, m)) set(d.key, Math.min(23, partsInTz(new Date(Date.now() + 3600e3), tz).h), 0);
                }}
                className={cn("relative flex h-[76px] w-[60px] shrink-0 snap-start flex-col items-center justify-center rounded-[22px] transition", on ? "text-background" : "bg-secondary/70 text-foreground hover:bg-secondary hairline")}
              >
                {on && <motion.span layoutId="dtp-day-pill" className="absolute inset-0 rounded-[22px] bg-foreground" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                <span className="relative text-[11px] font-medium uppercase tracking-wider opacity-70">{i === 0 ? "Today" : d.wd}</span>
                <span className="relative text-xl font-semibold tabular">{d.d}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-medium text-muted-foreground" id="dtp-time">Time</p>
          {peakHours.length > 0 && <p className="flex items-center gap-1 text-[12px] text-muted-foreground"><Flame className="h-3.5 w-3.5 text-cyan" aria-hidden="true" /> best time to post</p>}
        </div>
        <div ref={slotsRef} className="scrollbar-none -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1" role="group" aria-labelledby="dtp-time">
          {SLOTS.filter((s) => s.h >= 6).map((s) => {
            const on = v.h === s.h && v.min === s.m;
            const past = isPast(vKey, s.h, s.m);
            const peak = peakHours.includes(s.h);
            return (
              <button key={`${s.h}:${s.m}`} type="button" disabled={past} aria-pressed={on} onClick={() => set(vKey, s.h, s.m)} className={cn("relative h-11 shrink-0 snap-start rounded-full px-4 text-[13px] font-medium tabular transition", on ? "bg-foreground text-background" : "bg-secondary/70 hover:bg-secondary hairline", past && "opacity-30")}>
                {peak && !on && <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-cyan" aria-hidden="true" />}
                {label(s.h, s.m)}
                {peak && <span className="sr-only"> (best time to post)</span>}
              </button>
            );
          })}
        </div>
        <label className="mt-3 flex items-center gap-3 text-[13px] text-muted-foreground">
          Exact time
          <input type="time" value={`${String(v.h).padStart(2, "0")}:${String(v.min).padStart(2, "0")}`} onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); if (!isNaN(h)) set(vKey, h, m); }} className="h-10 rounded-xl bg-secondary px-3 text-foreground hairline" />
        </label>
        {elsewhere && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Times are in your studio time zone ({tz.replace(/_/g, " ")}), not this device&apos;s ({here!.replace(/_/g, " ")}).{" "}
            <Link href="/settings" className="font-medium text-foreground underline underline-offset-2">Change it</Link>
          </p>
        )}
      </div>
    </div>
  );
}

/** Next sensible slot: today 8 PM if it's still ahead, else tomorrow 8 PM (in the creator's tz). */
export function defaultSchedule(tz: string) {
  const n = partsInTz(new Date(), tz);
  const key = dayKey(new Date(), tz);
  const target = n.h < 19 ? key : addDaysKey(key, 1);
  const [y, m, d] = target.split("-").map(Number);
  return fromTzParts(y, m, d, 20, 0, tz);
}
