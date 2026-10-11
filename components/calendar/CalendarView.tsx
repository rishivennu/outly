"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D } from "@/components/brand/Icon3D";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { fmt, tzShort, useUser } from "@/components/shell/UserContext";
import { PostSheet } from "@/components/posts/PostSheet";
import { addDaysKey, dayKey } from "@/lib/client/tz";
import { cn } from "@/lib/utils";
import type { PostView } from "@/lib/services";

const at = (p: PostView) => p.scheduledAt ?? p.publishedAt ?? p.updatedAt;
const weekdayOf = (key: string) => (new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
const keyDate = (key: string) => new Date(`${key}T12:00:00Z`);

export function CalendarView({ initial }: { initial: PostView[] }) {
  const { timezone: tz } = useUser();
  const [posts, setPosts] = useState(initial);
  const today = dayKey(new Date(), tz);
  const [start, setStart] = useState(() => addDaysKey(today, -weekdayOf(today)));
  const [dir, setDir] = useState(0);
  const [open, setOpen] = useState<PostView | null>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysKey(start, i)), [start]);
  const byDay = useMemo(() => {
    const m = new Map<string, PostView[]>();
    for (const p of posts) {
      if (!p.scheduledAt && !p.publishedAt) continue;
      const k = dayKey(new Date(at(p)), tz);
      m.set(k, [...(m.get(k) ?? []), p].sort((a, b) => +new Date(at(a)) - +new Date(at(b))));
    }
    return m;
  }, [posts, tz]);
  const weekCount = days.reduce((n, d) => n + (byDay.get(d)?.filter((p) => p.status === "scheduled").length ?? 0), 0);
  const go = (n: number) => {
    setDir(n);
    setStart((s) => addDaysKey(s, n * 7));
  };
  const range = `${fmt(keyDate(days[0]), "UTC", { month: "short", day: "numeric" })} – ${fmt(keyDate(days[6]), "UTC", { month: "short", day: "numeric" })}`;

  return (
    <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow mb-3">Calendar · {tzShort(tz)}</p>
          <h1 className="display text-[clamp(2.6rem,6vw,4.6rem)]">{weekCount ? `${weekCount} going out this week.` : "A quiet week, so far."}</h1>
          {weekCount === 0 && (
            <div className="mt-6 flex items-center gap-4">
              <Icon3D name="schedule" size={72} className="animate-bob shrink-0" />
              <p className="max-w-xs text-muted-foreground">Nothing is queued between these dates. Plan something and it will wait right here.</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => go(-1)} aria-label="Previous week">
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <span className="tabular min-w-[140px] text-center text-sm font-medium" aria-live="polite">
            {range}
          </span>
          <Button variant="ghost" size="icon" onClick={() => go(1)} aria-label="Next week">
            <ChevronRight className="h-5 w-5" />
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setStart(addDaysKey(today, -weekdayOf(today)))} disabled={days.includes(today)}>
            Today
          </Button>
        </div>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.ol key={start} initial={{ opacity: 0, x: dir * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -40 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} className="mt-10 grid gap-3 md:grid-cols-7">
          {days.map((d) => {
            const items = byDay.get(d) ?? [];
            const isToday = d === today;
            const past = d < today;
            return (
              <li key={d} className={cn("flex min-h-[120px] flex-col rounded-[24px] p-2.5 md:min-h-[420px]", isToday ? "glass lime-ring" : "bg-card/50 hairline")} aria-label={fmt(keyDate(d), "UTC", { weekday: "long", month: "long", day: "numeric" })}>
                <div className="mb-3 flex items-baseline justify-between px-1.5 pt-1">
                  <span className={cn("text-xs font-semibold uppercase tracking-[0.14em]", isToday ? "text-foreground" : "text-muted-foreground")}>{fmt(keyDate(d), "UTC", { weekday: "short" })}</span>
                  <span className={cn("tabular grid h-8 w-8 place-items-center rounded-full text-sm font-semibold", isToday && "lime-bg")}>{fmt(keyDate(d), "UTC", { day: "numeric" })}</span>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {items.map((p) => (
                    <motion.button
                      key={p.id}
                      layout
                      type="button"
                      onClick={() => setOpen(p)}
                      whileHover={{ y: -2, rotate: -0.6 }}
                      className={cn("group relative block aspect-[4/5] w-full overflow-hidden rounded-2xl text-left hairline md:aspect-[3/4]", p.status === "published" && "opacity-75 hover:opacity-100")}
                      aria-label={`${p.title ?? "Untitled"}, ${fmt(at(p), tz, { hour: "numeric", minute: "2-digit" })}, ${p.status}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.media.thumbnailUrl && <img src={p.media.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" />}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/40" />
                      <span className="tabular absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">{fmt(at(p), tz, { hour: "numeric", minute: "2-digit" })}</span>
                      <div className="absolute inset-x-0 bottom-0 p-2.5 text-white">
                        <p className="line-clamp-2 text-[13px] font-semibold leading-tight">{p.title ?? "Untitled"}</p>
                        <span className="mt-1.5 flex -space-x-1.5">
                          {p.targets.map((t) => (
                            <PlatformOrb key={t.id} platform={t.platform} size={18} ring />
                          ))}
                        </span>
                      </div>
                      {p.status !== "scheduled" && <StatusBadge status={p.status} className="absolute right-2 top-2 hidden scale-90 md:inline-flex" />}
                    </motion.button>
                  ))}
                  {!past && items.length === 0 && (
                    <Link href="/create" className="group mt-auto flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground md:flex-1">
                      <Plus className="h-3.5 w-3.5" /> Plan something
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </motion.ol>
      </AnimatePresence>

      <PostSheet
        post={open}
        onClose={() => setOpen(null)}
        onChange={(np) => {
          setPosts((ps) => ps.map((x) => (x.id === np.id ? np : x)));
          setOpen(np);
        }}
        onRemove={(id) => setPosts((ps) => ps.filter((x) => x.id !== id))}
        onDuplicate={(np) => {
          setPosts((ps) => [np, ...ps]);
          setOpen(np);
        }}
      />
    </div>
  );
}
