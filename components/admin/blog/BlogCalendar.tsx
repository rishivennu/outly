"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, ChevronLeft, ChevronRight, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import type { BlogCalendarDay, BlogCalendarItem, BlogCalendarMonth, BlogJobView, BlogPostView } from "@/lib/blog/types";
import { Card, CardTitle, Pill } from "../ui";
import { CAL_STATUS, WEEKDAYS, agendaDays, dayLabel, monthGrid, monthTitle, shiftMonth } from "./calendar-grid";
import { addDays, fmtYmd, fmtZoned, isoToZoned, todayIn, zonedToIso } from "./zoned";

const MAX_IN_CELL = 3;

/**
 * R1178 blog calendar. Every mark on it is a real record from GET /api/admin/blog/calendar: runs, drafts,
 * approvals and publications on the day they sit, plus the daily run marker and skipped days. Picking a day
 * opens its panel, where an admin can generate for that date, skip it, or move an approved article.
 */
export function BlogCalendar({ initial, ready }: { initial: BlogCalendarMonth; ready: boolean }) {
  const [cal, setCal] = useState(initial);
  const [sel, setSel] = useState<string>(initial.today.startsWith(initial.month) ? initial.today : initial.days[0]?.date ?? initial.today);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();
  const weeks = useMemo(() => monthGrid(cal.days), [cal.days]);
  const agenda = useMemo(() => agendaDays(cal.days), [cal.days]);
  const day = cal.days.find((d) => d.date === sel) ?? null;

  async function load(month: string, keep?: string) {
    setLoading(true);
    setErr(null);
    try {
      const r = await adminApi<{ calendar: BlogCalendarMonth }>(`/api/admin/blog/calendar?month=${month}`);
      setCal(r.calendar);
      setSel(keep && keep.startsWith(r.calendar.month) ? keep : r.calendar.today.startsWith(r.calendar.month) ? r.calendar.today : r.calendar.days[0]?.date ?? "");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function generate(date: string) {
    setBusy("generate");
    setErr(null);
    try {
      const r = await adminApi<{ job: BlogJobView; existed: boolean }>("/api/admin/blog/jobs", { method: "POST", json: date === cal.today ? {} : { forDate: date } });
      toast(r.existed ? "A run is already going; showing it" : `Run started for ${fmtYmd(date)}`);
      // The run is driven stage by stage from the Generate page, so that is where it continues.
      router.push("/admin/blog/generate");
    } catch (e: any) {
      setErr(e.message);
      setBusy(null);
    }
  }

  async function skip(date: string, action: "skip" | "unskip") {
    setBusy(action);
    setErr(null);
    try {
      await adminApi<{ skipDates: string[] }>("/api/admin/blog/schedule", { method: "POST", json: { action, date } });
      toast(action === "skip" ? `No scheduled run on ${fmtYmd(date)}` : `${fmtYmd(date)} is back on the schedule`);
      await load(cal.month, date);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLButtonElement>, date: string) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    const next = addDays(date, step);
    if (!next.startsWith(cal.month)) return;
    e.preventDefault();
    setSel(next);
    document.querySelector<HTMLButtonElement>(`[data-cal-day="${next}"]`)?.focus();
  }

  const statusLine = cal.paused ? null : cal.enabled ? `Daily run at ${cal.startTime} ${cal.timezone}, ready by ${cal.readyBy}.` : null;

  return (
    <div className="grid gap-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[1.25rem] font-semibold tracking-tight" aria-live="polite">
              {monthTitle(cal.month)}
              {loading && <Loader2 className="ml-2 inline h-4 w-4 animate-spin motion-reduce:animate-none" aria-label="Loading" />}
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {statusLine ?? (
                <>
                  {cal.paused ? "Paused: no runs start, scheduled or manual." : "Scheduled runs are off."}{" "}
                  <Link href="/admin/blog/settings" className="underline underline-offset-4">
                    Blog settings
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon" onClick={() => load(shiftMonth(cal.month, -1))} disabled={loading} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            {!cal.today.startsWith(cal.month) && (
              <Button type="button" variant="outline" onClick={() => load(cal.today.slice(0, 7))} disabled={loading}>
                This month
              </Button>
            )}
            <Button type="button" variant="outline" size="icon" onClick={() => load(shiftMonth(cal.month, 1))} disabled={loading} aria-label="Next month">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>

        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Legend">
          {Object.entries(CAL_STATUS).map(([k, s]) => (
            <li key={k}>
              <Pill tone={s.tone}><StatusDot />{s.label}</Pill>
            </li>
          ))}
          <li>
            <span className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-[11.5px] font-semibold text-muted-foreground">Run at {cal.startTime}</span>
          </li>
          <li>
            <span className="inline-flex h-6 items-center rounded-full border border-border px-2.5 text-[11.5px] font-semibold text-muted-foreground line-through">Skipped</span>
          </li>
        </ul>

        {err && (
          <p role="alert" className="mt-3 text-[13.5px] text-destructive">
            {err}
          </p>
        )}

        <div className="mt-4 hidden sm:block">
          <div aria-label={`${monthTitle(cal.month)} blog calendar`} role="group" className="grid gap-1.5">
            <div aria-hidden className="grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map((w) => (
                <div key={w} className="px-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {w}
                </div>
              ))}
            </div>
            {weeks.map((week, i) => (
              <div key={i} className="grid grid-cols-7 gap-1.5">
                {week.map((d, j) =>
                  d ? (
                    <div
                      key={d.date}
                      className={cn("flex min-h-[7.5rem] min-w-0 flex-col gap-1 rounded-2xl border p-1.5", d.date === cal.today ? "border-2 border-foreground" : "border-border", d.date === sel && "bg-secondary/60", d.skipped && "bg-secondary/30")}
                    >
                      <DayButton d={d} cal={cal} sel={sel} onPick={setSel} onKey={onKey} />
                      <ul className="grid min-w-0 gap-1">
                        {d.items.slice(0, MAX_IN_CELL).map((it) => (
                          <li key={it.kind + it.id} className="min-w-0">
                            <ItemLink it={it} compact />
                          </li>
                        ))}
                      </ul>
                      {d.items.length > MAX_IN_CELL && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setSel(d.date)} className="h-8 justify-start rounded-lg px-1 text-[12px] text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {d.items.length - MAX_IN_CELL} more
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div key={`pad-${i}-${j}`} aria-hidden className="min-h-[7.5rem]" />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 sm:hidden">
          {agenda.length ? (
            <ul className="grid gap-2" aria-label={`${monthTitle(cal.month)} agenda`}>
              {agenda.map((d) => (
                <li key={d.date} className={cn("rounded-2xl border p-3", d.date === cal.today ? "border-2 border-foreground" : "border-border", d.date === sel && "bg-secondary/60")}>
                  <DayButton d={d} cal={cal} sel={sel} onPick={setSel} wide />
                  {d.items.length > 0 && (
                    <ul className="mt-1.5 grid gap-1.5">
                      {d.items.map((it) => (
                        <li key={it.kind + it.id}>
                          <ItemLink it={it} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-muted-foreground">Nothing on this month yet.</p>
          )}
        </div>
      </Card>

      {day && <DayPanel day={day} cal={cal} ready={ready} busy={busy} onGenerate={generate} onSkip={skip} onChanged={() => load(cal.month, day.date)} />}
    </div>
  );
}

function DayButton({ d, cal, sel, onPick, onKey, wide = false }: { d: BlogCalendarDay; cal: BlogCalendarMonth; sel: string; onPick: (date: string) => void; onKey?: (e: React.KeyboardEvent<HTMLButtonElement>, date: string) => void; wide?: boolean }) {
  return (
    <button
      type="button"
      data-cal-day={onKey ? d.date : undefined}
      tabIndex={onKey ? (d.date === sel ? 0 : -1) : undefined}
      aria-label={dayLabel(d, cal.startTime, cal.today)}
      aria-pressed={d.date === sel}
      onClick={() => onPick(d.date)}
      onKeyDown={onKey ? (e) => onKey(e, d.date) : undefined}
      className={cn("flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-xl px-1.5 text-left transition-colors duration-hover hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", wide && "justify-between")}
    >
      <span className={cn("text-[14px] font-semibold tabular-nums", d.date < cal.today && "text-muted-foreground")}>{wide ? fmtYmd(d.date, { weekday: "short", day: "numeric", month: "short" }) : Number(d.date.slice(8))}</span>
      <span className="flex flex-wrap items-center gap-1" aria-hidden>
        {d.date === cal.today && <span className="text-[11px] font-semibold uppercase tracking-wide">Today</span>}
        {d.scheduledRun && <span className="rounded-full border border-dashed border-border px-1.5 text-[11px] text-muted-foreground">Run at {cal.startTime}</span>}
        {d.skipped && <span className="rounded-full border border-border px-1.5 text-[11px] text-muted-foreground line-through">Skipped</span>}
      </span>
    </button>
  );
}

/** The kit badge carries a dot; these tones are the calendar's own, so the dot takes the word's colour. */
export function StatusDot() {
  return <span data-dot="" aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />;
}

function ItemLink({ it, compact = false }: { it: BlogCalendarItem; compact?: boolean }) {
  const s = CAL_STATUS[it.status] ?? { label: it.status, tone: "muted" as const };
  return (
    <Link href={it.href} title={it.title} className={cn("group flex min-w-0 rounded-lg px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", compact ? "flex-col items-start gap-0.5" : "min-h-11 items-center gap-2")}>
      <Pill tone={s.tone} className={cn(compact && "h-5 px-2 text-[10.5px]")}><StatusDot />{s.label}</Pill>
      <span className="w-full min-w-0 truncate text-[12.5px] underline underline-offset-4">{it.title}</span>
    </Link>
  );
}

function DayPanel({ day, cal, ready, busy, onGenerate, onSkip, onChanged }: { day: BlogCalendarDay; cal: BlogCalendarMonth; ready: boolean; busy: string | null; onGenerate: (date: string) => void; onSkip: (date: string, action: "skip" | "unskip") => void; onChanged: () => void }) {
  const past = day.date < cal.today;
  const isToday = day.date === cal.today;
  const tooFar = day.date > addDays(cal.today, 60);
  return (
    <Card aria-label={`${fmtYmd(day.date)} details`}>
      <CardTitle hint={past ? "A past day: shown as it happened." : day.skipped ? "Skipped: the daily run will not start this day." : day.scheduledRun ? `The daily run starts at ${cal.startTime} ${cal.timezone}.` : isToday ? "No more scheduled runs today." : "No scheduled run this day."}>
        {fmtYmd(day.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      </CardTitle>

      {day.items.length ? (
        <ul className="grid gap-2">
          {day.items.map((it) => (
            <li key={it.kind + it.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={(CAL_STATUS[it.status] ?? CAL_STATUS.cancelled).tone}><StatusDot />{CAL_STATUS[it.status]?.label ?? it.status}</Pill>
                <Link href={it.href} className="min-w-0 font-medium underline underline-offset-4">
                  {it.title}
                </Link>
              </div>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {fmtZoned(it.at, cal.timezone)}
                {it.note ? `. ${it.note}` : ""}
              </p>
              {it.kind === "post" && (it.status === "approved" || it.status === "scheduled") && (
                <div className="mt-2">
                  <PublishLaterForm
                    idPrefix={`cal-${it.id}`}
                    timezone={cal.timezone}
                    initialAt={it.status === "scheduled" ? it.at : null}
                    submitLabel="Reschedule"
                    submit={async (at) => {
                      await adminApi<{ post: BlogPostView }>(`/api/admin/blog/posts/${it.id}`, { method: "POST", json: { action: "schedule", at } });
                      onChanged();
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13.5px] text-muted-foreground">Nothing on this day.</p>
      )}

      {!past && (
        <div className="mt-4 flex flex-wrap gap-2">
          {!tooFar && (
            <Button type="button" variant="lime" onClick={() => onGenerate(day.date)} disabled={!ready || cal.paused || busy !== null} title={!ready ? "No AI key is set for the blog" : cal.paused ? "The blog is paused in settings" : undefined}>
              {busy === "generate" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Wand2 className="h-4 w-4" aria-hidden />}
              {isToday ? "Generate for today" : "Generate for this date"}
            </Button>
          )}
          {day.skipped ? (
            <Button type="button" variant="outline" onClick={() => onSkip(day.date, "unskip")} disabled={busy !== null}>
              {busy === "unskip" && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />} Undo skip
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onSkip(day.date, "skip")} disabled={busy !== null}>
              {busy === "skip" && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />} Skip this day
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * R1178 "Approve and publish on ...": a person picks the moment, read on the blog's own clock and sent as an
 * ISO instant. The server runs the publish checks before accepting it; its error text is shown here as is.
 */
export function PublishLaterForm({ idPrefix, timezone, initialAt, submit, submitLabel, onCancel }: { idPrefix: string; timezone: string; initialAt?: string | null; submit: (at: string) => Promise<void>; submitLabel?: string; onCancel?: () => void }) {
  const today = todayIn(timezone);
  const start = initialAt ? isoToZoned(initialAt, timezone) : { date: addDays(today, 1), time: "09:00" };
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!initialAt) return;
    const z = isoToZoned(initialAt, timezone);
    setDate(z.date);
    setTime(z.time);
  }, [initialAt, timezone]);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    let at: string;
    try {
      at = zonedToIso(date, time, timezone);
    } catch (x: any) {
      setErr(x.message);
      return;
    }
    if (new Date(at).getTime() <= Date.now()) return setErr("Pick a moment in the future.");
    setBusy(true);
    try {
      await submit(at);
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  const when = date && time ? `${fmtYmd(date, { day: "numeric", month: "short" })} at ${time}` : "...";
  return (
    <form onSubmit={go} className="grid gap-2 sm:grid-cols-[auto_auto_1fr] sm:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-d`}>Date</Label>
        <Input id={`${idPrefix}-d`} type="date" value={date} min={today} max={addDays(today, 90)} onChange={(e) => setDate(e.target.value)} required className="min-h-11" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-t`}>Time ({timezone})</Label>
        <Input id={`${idPrefix}-t`} type="time" value={time} onChange={(e) => setTime(e.target.value)} required className="min-h-11" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy || !date || !time} className="min-h-11">
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <CalendarClock className="h-4 w-4" aria-hidden />}
          {submitLabel ? `${submitLabel} to ${when}` : `Approve and publish on ${when}`}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy} className="min-h-11">
            Close
          </Button>
        )}
      </div>
      {err && (
        <p role="alert" className="text-[13px] text-destructive sm:col-span-3">
          {err}
        </p>
      )}
    </form>
  );
}
