"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CalendarClock, CalendarDays, Flame, Pencil, Plus, Rocket, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D } from "@/components/brand/Icon3D";
import { Sheet } from "@/components/shared/Sheet";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DateTimePicker } from "@/components/shared/DateTimePicker";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { fmt, tzShort } from "@/components/shell/UserContext";
import { PLATFORM_META, PLATFORMS, type Platform } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client/api";
import type { BestTimes } from "@/lib/schedule/best-time";
import type { AccountView, Draft } from "./types";

interface Props {
  drafts: Record<Platform, Draft>;
  accounts: Partial<Record<Platform, AccountView>>;
  poster: string | null;
  hook: string;
  tz: string;
  when: Date;
  onWhen: (d: Date) => void;
  mode: "now" | "schedule";
  onMode: (m: "now" | "schedule") => void;
  busy: boolean;
  error: string | null;
  onLaunch: () => void;
  onEdit: () => void;
}

export function LaunchPanel(p: Props) {
  const [picking, setPicking] = useState(false);
  const targets = PLATFORMS.filter((pl) => p.drafts[pl].enabled);
  const names = targets.map((t) => PLATFORM_META[t].name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  const [best, setBest] = useState<BestTimes | null>(null);
  const key = targets.join(",");
  useEffect(() => {
    let live = true;
    api<BestTimes>(`/api/best-time?platforms=${key}`)
      .then((b) => live && setBest(b))
      .catch(() => live && setBest(null));
    return () => {
      live = false;
    };
  }, [key]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <p className="eyebrow mb-3">04 · Launch</p>
      <h2 className="display text-[clamp(2.4rem,6vw,4.2rem)]">
        Ready when
        <br />
        <span className="energy-text">you are.</span>
      </h2>

      <div className="glass mt-8 flex gap-4 rounded-[28px] p-4">
        <div className="relative aspect-[9/16] w-20 shrink-0 overflow-hidden rounded-2xl bg-secondary sm:w-24">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {p.poster && <img src={p.poster} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1 py-1">
          <p className="line-clamp-2 text-lg font-semibold leading-snug">{p.hook}</p>
          <ul className="mt-3 space-y-2">
            {targets.map((pl) => (
              <li key={pl} className="flex items-center gap-2.5 text-sm">
                <PlatformOrb platform={pl} size={24} />
                <span className="font-medium">{PLATFORM_META[pl].format}</span>
                <span className="truncate text-muted-foreground">
                  {p.accounts[pl]?.username} · {(pl === "youtube" ? p.drafts[pl].title : p.drafts[pl].caption).split("\n")[0]}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Button variant="ghost" size="icon" onClick={p.onEdit} aria-label="Edit the copy" className="shrink-0">
          <Pencil className="h-4 w-4" />
        </Button>
      </div>

      <div role="radiogroup" aria-label="When should this go live?" className="mt-8 grid grid-cols-2 gap-2 rounded-full bg-secondary/60 p-1.5 hairline">
        {(["now", "schedule"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={p.mode === m} onClick={() => p.onMode(m)} className={cn("relative h-12 rounded-full text-sm font-semibold transition", p.mode === m ? "text-background" : "text-muted-foreground hover:text-foreground")}>
            {p.mode === m && <motion.span layoutId="launch-mode" className="absolute inset-0 rounded-full bg-foreground" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span className="relative inline-flex items-center gap-2">
              {m === "now" ? <Send className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
              {m === "now" ? "Send it now" : "Schedule it"}
            </span>
          </button>
        ))}
      </div>

      {p.mode === "schedule" && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => setPicking(true)}
          className="glass mt-4 flex w-full items-center gap-4 rounded-[24px] p-4 text-left transition hover:bg-secondary/60"
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-warning/15 text-warning">
            <CalendarDays className="h-5 w-5" />
          </span>
          <span className="flex-1">
            <span className="block text-xs text-muted-foreground">When should this go live?</span>
            <span className="block text-lg font-semibold">
              {fmt(p.when, p.tz, { weekday: "long", month: "short", day: "numeric" })} · {fmt(p.when, p.tz, { hour: "numeric", minute: "2-digit" })}{" "}
              <span className="text-sm font-normal text-muted-foreground">{tzShort(p.tz)}</span>
            </span>
          </span>
          <span className="text-sm text-muted-foreground">Change</span>
        </motion.button>
      )}

      {p.mode === "schedule" && best && best.slots.length > 0 && (
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} aria-labelledby="best-times" className="mt-3 rounded-[24px] p-4 hairline">
          <h3 id="best-times" className="flex items-center gap-2 text-sm font-semibold">
            <Flame className="h-4 w-4 text-cyan" aria-hidden="true" /> Best times to post
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{best.source === "yours" ? "From your posts" : "Typical"}</span>
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {best.slots.map((s) => {
              const on = Math.abs(new Date(s.at).getTime() - p.when.getTime()) < 60_000;
              return (
                <button key={s.at} type="button" aria-pressed={on} onClick={() => p.onWhen(new Date(s.at))} className={cn("h-11 rounded-full px-4 text-sm font-semibold transition hairline", on ? "bg-foreground text-background" : "hover:bg-secondary/70")}>
                  {s.label}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{best.reason}</p>
        </motion.section>
      )}

      <div className="mt-8 flex flex-col items-center gap-3">
        <Button variant="lime" size="xl" className="w-full sm:w-auto sm:min-w-[320px]" disabled={p.busy || targets.length === 0} onClick={p.onLaunch}>
          {p.mode === "now" ? (
            <>
              <Rocket className="h-5 w-5" /> {p.busy ? "Sending it out…" : "Send it everywhere"}
            </>
          ) : (
            <>
              <CalendarClock className="h-5 w-5" /> {p.busy ? "Putting it on the calendar…" : "Schedule it"}
            </>
          )}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          {p.mode === "now" ? `Goes to ${list} right away.` : `Goes to ${list} at that time. You can change it until then.`}
        </p>
        {p.error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {p.error}
          </p>
        )}
      </div>

      <Sheet open={picking} onOpenChange={setPicking} title="When should this go live?" description={`Times are in ${tzShort(p.tz)}.${best?.peakHours.length ? " Dots mark the best times to post." : ""}`} side="center">
        <DateTimePicker value={p.when} onChange={p.onWhen} tz={p.tz} peakHours={best?.peakHours ?? []} />
        <Button variant="primary" size="lg" className="mt-6 w-full" onClick={() => setPicking(false)}>
          That works
        </Button>
      </Sheet>
    </div>
  );
}

export function ScheduledView({ when, tz, poster, onAnother }: { when: string; tz: string; poster: string | null; onAnother: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto flex max-w-xl flex-col items-center py-10 text-center">
      <motion.div initial={{ rotate: -8, y: 20 }} animate={{ rotate: -4, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 14 }} className="glass-strong relative mb-10 w-52 rounded-[28px] p-3 shadow-[0_40px_80px_-30px_hsl(var(--warning)/0.4)]">
        <div className="rounded-t-2xl bg-warning px-4 py-2 text-left text-sm font-bold uppercase tracking-wider text-[hsl(var(--lime-foreground))]">{fmt(when, tz, { month: "long" })}</div>
        <div className="flex items-center gap-3 p-4">
          <span className="display text-6xl tabular">{fmt(when, tz, { day: "numeric" })}</span>
          <span className="text-left text-sm text-muted-foreground">
            {fmt(when, tz, { weekday: "long" })}
            <br />
            {fmt(when, tz, { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
        {poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" className="absolute -right-8 -top-6 aspect-[9/16] w-16 rotate-[10deg] rounded-xl object-cover shadow-xl hairline" />
        )}
      </motion.div>
      <Icon3D name="schedule" size={88} className="mb-6" />
      <h2 className="display text-[clamp(2.4rem,6vw,4rem)]">It&apos;s on the calendar.</h2>
      <StatusBadge status="scheduled" className="mt-4" />
      <p className="mt-4 text-lg text-muted-foreground">We&apos;ll send it out {fmt(when, tz, { weekday: "long", hour: "numeric", minute: "2-digit" })} {tzShort(tz)}. Change it any time before then.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild variant="primary" size="lg">
          <Link href="/calendar">
            <CalendarDays className="h-5 w-5" /> See the calendar
          </Link>
        </Button>
        <Button variant="subtle" size="lg" onClick={onAnother}>
          <Plus className="h-5 w-5" /> Create another
        </Button>
      </div>
    </motion.div>
  );
}
