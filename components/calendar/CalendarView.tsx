"use client";
import { ease } from "@/lib/motion/tokens";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D } from "@/components/brand/Icon3D";
import { fmt, tzShort, useUser, useUserKey } from "@/components/shell/UserContext";
import { PostSheet } from "@/components/posts/PostSheet";
import { dayKey } from "@/lib/client/tz";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError, cachedApi } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { useTabMemory } from "@/lib/client/tab-state";
import { AnimatedNumber } from "@/components/shared/AnimatedNumber";
import { attentionFor, displayStatus, type AccountState, type DisplayStatus } from "@/lib/posts/attention";
import { covered, groupByDay, isDayKey, isUnscheduledDraft, isView, mergeWindow, onPage, rangeOf, sameTimeOn, shiftAnchor, upcomingOf, upsertAll, visibleDays, type CalView } from "@/lib/calendar/range";
import type { CalendarPost } from "@/lib/calendar/load";
import type { PostView } from "@/lib/services";
import { PostCard, movable } from "./PostCard";
import { ViewSwitch } from "./ViewSwitch";
import { QuickActions } from "./QuickActions";
import { DayView } from "./DayView";
import { MonthView } from "./MonthView";
import { UpcomingList } from "./UpcomingList";
import { DraftsTray } from "./DraftsTray";
import { MoveDialog } from "./MoveDialog";

const keyDate = (key: string) => new Date(`${key}T12:00:00Z`);
type Win = readonly [number, number];
/** A window the server cut short: [from, to, how many it sent]. */
type Cut = readonly [number, number, number];
type Page = { posts: CalendarPost[]; nextCursor: string | null; accounts: AccountState[]; truncated?: boolean };
const prefKey = (who: string) => `outlly:calendar-view:${who}`;
const UNIT: Record<CalView, string> = { day: "day", week: "week", month: "month", upcoming: "page" };

interface Props {
  initial: CalendarPost[];
  /** The [from, to) instants `initial` covers (the current week, from the page). */
  loaded: Win;
  drafts: { posts: CalendarPost[]; nextCursor: string | null };
  accounts: AccountState[];
  /** The server had more than it sent for `loaded`. */
  truncated?: boolean;
}

export function CalendarView({ initial, loaded, drafts: firstDrafts, accounts: firstAccounts, truncated = false }: Props) {
  const { timezone: tz } = useUser();
  const who = useUserKey();
  const [posts, setPosts] = useState(initial);
  const [wins, setWins] = useState<Win[]>([loaded]);
  const [cuts, setCuts] = useState<Cut[]>(truncated ? [[loaded[0], loaded[1], initial.length]] : []);
  const [drafts, setDrafts] = useState(firstDrafts);
  const [accounts, setAccounts] = useState(firstAccounts);
  const [up, setUp] = useState<{ loaded: boolean; nextCursor: string | null; horizon: string | null }>({ loaded: false, nextCursor: null, horizon: null });
  // 1114: a newer server render (the page bringing a preloaded copy up to date, or a refresh) replaces the list.
  const [from, setFrom] = useState(initial);
  if (from !== initial) {
    setFrom(initial);
    setPosts(initial);
    setWins([loaded]);
    setCuts(truncated ? [[loaded[0], loaded[1], initial.length]] : []);
    setDrafts(firstDrafts);
    setAccounts(firstAccounts);
    setUp({ loaded: false, nextCursor: null, horizon: null });
  }
  const today = dayKey(new Date(), tz);
  // 1114: the day you were on comes back with you from another tab (at most a year either way). P2: so does the view.
  const week = useTabMemory("calendar", (v) => (isDayKey(v) && Math.abs(+keyDate(v) - +keyDate(today)) < 366 * 864e5 ? v : null));
  const viewMem = useTabMemory("calendar:view", (v) => (isView(v) ? v : null));
  const [anchor, setAnchor] = useState(() => week.saved ?? today);
  const [view, setView] = useState<CalView>(() => viewMem.saved ?? "week");
  const { save: saveWeek } = week;
  const { save: saveView } = viewMem;
  useEffect(() => saveWeek(anchor), [anchor, saveWeek]);
  // The view you like is kept on this device too (a full reload starts on it after hydration).
  const restored = useRef(viewMem.saved !== null);
  useEffect(() => {
    if (restored.current || !who) return;
    restored.current = true;
    try {
      const v = localStorage.getItem(prefKey(who));
      if (isView(v) && v !== "week") setView(v);
    } catch {
      /* storage blocked: the default view */
    }
  }, [who]);
  useEffect(() => {
    saveView(view);
    if (!who) return;
    try {
      localStorage.setItem(prefKey(who), view);
    } catch {
      /* storage blocked or full */
    }
  }, [view, who, saveView]);

  const [dir, setDir] = useState(0);
  const [open, setOpen] = useState<CalendarPost | null>(null);
  const [moving, setMoving] = useState<{ post: CalendarPost; at: Date | null } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const toast = useToast();

  const days = useMemo(() => visibleDays(view, anchor), [view, anchor]);
  const range = useMemo(() => (days.length ? rangeOf(days, tz) : null), [days, tz]);
  const fromMs = range ? +range.from : 0;
  const toMs = range ? +range.to : 0;
  // A cut window counts as loaded for itself (asking again gets the same first page), never for a narrower view inside it.
  const complete = useMemo(() => wins.filter((w) => !cuts.some((c) => c[0] === w[0] && c[1] === w[1])), [wins, cuts]);
  const whole = covered(complete, fromMs, toMs);
  const ready = !range || whole || cuts.some((c) => c[0] === fromMs && c[1] === toMs);
  const cut = range && !whole ? cuts.find((c) => c[0] < toMs && fromMs < c[1]) : undefined;

  // Only the days on screen are asked for (P2: no 90 days for one day). A page already seen is not asked again.
  const seq = useRef(0);
  useEffect(() => {
    if (!fromMs || ready) return;
    const my = ++seq.current;
    setLoading(true);
    setLoadError(null);
    cachedApi<Page>(`/api/calendar?list=range&from=${encodeURIComponent(new Date(fromMs).toISOString())}&to=${encodeURIComponent(new Date(toMs).toISOString())}`, 30_000)
      .then((r) => {
        if (my !== seq.current) return;
        setPosts((ps) => mergeWindow(ps, r.posts, fromMs, toMs));
        setWins((w) => [...w, [fromMs, toMs] as const]);
        if (r.truncated) setCuts((c) => [...c, [fromMs, toMs, r.posts.length] as const]);
        setAccounts(r.accounts);
      })
      .catch((e) => my === seq.current && setLoadError(e instanceof ApiError ? e.message : "Couldn't load these dates. Check your connection and try again."))
      .finally(() => my === seq.current && setLoading(false));
  }, [fromMs, ready, toMs, retry]);

  const [upBusy, setUpBusy] = useState(false);
  const [upError, setUpError] = useState<string | null>(null);
  const loadUpcoming = useCallback(
    async (cursor: string | null) => {
      setUpBusy(true);
      setUpError(null);
      try {
        const r = await cachedApi<Page>(`/api/calendar?list=upcoming${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, 30_000);
        setPosts((ps) => upsertAll(ps, r.posts));
        setAccounts(r.accounts);
        setUp({ loaded: true, nextCursor: r.nextCursor, horizon: r.nextCursor ? (r.posts[r.posts.length - 1]?.scheduledAt ?? null) : null });
      } catch (e) {
        setUpError(e instanceof ApiError ? e.message : "Couldn't load what's coming up. Check your connection and try again.");
      } finally {
        setUpBusy(false);
      }
    },
    [],
  );
  useEffect(() => {
    if (view === "upcoming" && !up.loaded && !upBusy && !upError) void loadUpcoming(null);
  }, [view, up.loaded, upBusy, upError, loadUpcoming]);

  const [draftBusy, setDraftBusy] = useState(false);
  const moreDrafts = async () => {
    if (!drafts.nextCursor) return;
    setDraftBusy(true);
    try {
      const r = await cachedApi<Page>(`/api/calendar?list=drafts&cursor=${encodeURIComponent(drafts.nextCursor)}`, 30_000);
      setDrafts((d) => ({ posts: upsertAll(d.posts, r.posts), nextCursor: r.nextCursor }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't load more drafts. Check your connection and try again.", "error");
    } finally {
      setDraftBusy(false);
    }
  };

  // What a card says. "Requires attention" is worked out from the post and its accounts (lib/posts/attention.ts).
  const statusMap = useMemo(() => {
    const m = new Map<string, DisplayStatus>();
    for (const p of [...posts, ...drafts.posts]) m.set(p.id, displayStatus(p, attentionFor(p, accounts)));
    return m;
  }, [posts, drafts.posts, accounts]);
  const statusOf = useCallback((p: CalendarPost) => statusMap.get(p.id) ?? displayStatus(p, attentionFor(p, accounts)), [statusMap, accounts]);

  /** A post as some route sent it back: keeps what only the calendar loads, and goes to the tray or a day. */
  const known = useRef<Map<string, CalendarPost>>(new Map());
  known.current = new Map([...posts, ...drafts.posts].map((p) => [p.id, p]));
  const upsert = useCallback((np: PostView): CalendarPost => {
    const prev = known.current.get(np.id);
    const full: CalendarPost = { ...np, accountIds: prev?.accountIds ?? {}, slideCount: np.items.length || (prev?.slideCount ?? 0) };
    if (isUnscheduledDraft(full)) {
      setPosts((ps) => ps.filter((x) => x.id !== full.id));
      setDrafts((d) => ({ ...d, posts: d.posts.some((x) => x.id === full.id) ? d.posts.map((x) => (x.id === full.id ? full : x)) : [full, ...d.posts] }));
    } else {
      setPosts((ps) => upsertAll(ps, [full]));
      setDrafts((d) => ({ ...d, posts: d.posts.filter((x) => x.id !== full.id) }));
    }
    return full;
  }, []);
  const removeLocal = useCallback((id: string) => {
    setPosts((ps) => ps.filter((x) => x.id !== id));
    setDrafts((d) => ({ ...d, posts: d.posts.filter((x) => x.id !== id) }));
  }, []);

  /** A drop on a day: same time of day there, and nothing saves until the Move sheet's check and confirm. */
  const dropOn = (id: string, key: string) => {
    const p = posts.find((x) => x.id === id);
    if (!p?.scheduledAt || !movable(p)) return;
    if (dayKey(new Date(p.scheduledAt), tz) === key) return;
    const next = sameTimeOn(p.scheduledAt, key, tz);
    if (next.getTime() < Date.now() + 60_000) return toast("That time has already passed. Pick a later day.", "info");
    setMoving({ post: p, at: next });
  };
  const dropFor = (d: string, past: boolean) => ({
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!dragId || past) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropKey !== d) setDropKey(d);
    },
    onDragLeave: (e: React.DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropKey((k) => (k === d ? null : k));
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/x-outlly-post") || dragId;
      setDragId(null);
      setDropKey(null);
      if (id) dropOn(id, d);
    },
    "data-drop": dropKey === d,
  });
  const dragStart = useCallback((id: string) => setDragId(id), []);
  const dragEnd = useCallback(() => {
    setDragId(null);
    setDropKey(null);
  }, []);
  const openPost = useCallback((p: CalendarPost) => setOpen(p), []);
  const movePost = useCallback((p: CalendarPost) => setMoving({ post: p, at: null }), []);
  const cards = { tz, statusOf, onOpen: openPost, onMove: movePost };

  const byDay = useMemo(() => groupByDay(posts, tz), [posts, tz]);
  const upcoming = useMemo(() => upcomingOf(posts, Date.now(), up.horizon), [posts, up.horizon]);
  const weekCount = view === "upcoming" ? upcoming.filter((p) => p.status === "scheduled").length : days.reduce((n, d) => n + (byDay.get(d)?.filter((p) => p.status === "scheduled").length ?? 0), 0);
  const go = (n: number) => {
    setDir(n);
    setAnchor((a) => shiftAnchor(view, a, n));
  };
  const pickView = (v: CalView) => {
    setDir(0);
    setView(v);
  };
  const short = (k: string) => fmt(keyDate(k), "UTC", { month: "short", day: "numeric" });
  const label =
    view === "day"
      ? fmt(keyDate(anchor), "UTC", { weekday: "long", month: "short", day: "numeric" })
      : view === "week"
        ? `${short(days[0])} to ${short(days[6])}`
        : view === "month"
          ? fmt(keyDate(`${anchor.slice(0, 7)}-15`), "UTC", { month: "long", year: "numeric" })
          : "";
  const counted = weekCount > 0 && !(view === "upcoming" && up.nextCursor);
  const suffix = view === "day" ? (anchor === today ? "going out today." : "going out that day.") : view === "month" ? "going out this month." : view === "upcoming" ? "coming up." : "going out this week.";
  const quiet = view === "day" ? (anchor < today ? "A quiet day." : "A quiet day, so far.") : view === "month" ? "A quiet month, so far." : view === "upcoming" ? (up.nextCursor ? "What's coming up." : "Nothing coming up yet.") : "A quiet week, so far.";

  return (
    <div className="page-frame pb-16 pt-8 lg:pt-14">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow mb-3">Calendar · {tzShort(tz)}</p>
          <h1 className="display text-[clamp(2.6rem,6vw,4.6rem)]">{/* 1114: the count runs up when the Calendar is opened, and moves on as you change week. */}
            {counted ? (
              <>
                <AnimatedNumber value={weekCount} format="int" tier="main" id="calendar:week" /> {suffix}
              </>
            ) : (
              quiet
            )}</h1>
          {weekCount === 0 && view === "week" && ready && (
            <div className="mt-6 flex items-center gap-4">
              <Icon3D name="schedule" size={72} className="animate-bob shrink-0" />
              <p className="max-w-xs text-muted-foreground">Nothing is queued between these dates. Plan something and it will wait right here.</p>
            </div>
          )}
        </div>
        {view !== "upcoming" && (
          <div className="flex flex-wrap items-center gap-2" data-guide="cal-weeks">
            <Button variant="ghost" size="icon" onClick={() => go(-1)} aria-label={`Previous ${UNIT[view]}`}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="tabular-nums min-w-0 text-center sm:min-w-[140px] text-sm font-medium" aria-live="polite">
              {label}
            </span>
            <Button variant="ghost" size="icon" onClick={() => go(1)} aria-label={`Next ${UNIT[view]}`}>
              <ChevronRight className="h-5 w-5" />
            </Button>
            {!onPage(view, anchor, today) && (
              <Button variant="subtle" size="sm" className="max-lg:h-11" onClick={() => setAnchor(today)}>
                Today
              </Button>
            )}
          </div>
        )}
      </header>

      <div className="mt-8 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <ViewSwitch value={view} onChange={pickView} />
        <QuickActions />
      </div>

      {loadError && view !== "upcoming" && (
        <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-destructive/5 p-4 text-sm hairline">
          <span>{loadError}</span>
          <Button variant="subtle" size="sm" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}

      {cut && view !== "upcoming" && (
        <p role="status" className="mt-6 rounded-2xl bg-secondary p-4 text-sm text-foreground hairline">
          <span className="tabular-nums">{view === "day" ? `Showing the first ${cut[2]} posts on this day.` : `Showing the first ${cut[2]}. Narrow the view to see the rest.`}</span>
        </p>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${view}:${days[0] ?? "up"}`}
          initial={{ opacity: 0, x: dir * 32, y: dir ? 0 : 8 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: dir * -32, y: 0 }}
          transition={{ duration: 0.32, ease: ease("out") }}
          className="mt-8"
          aria-busy={loading && !ready}
        >
          {view === "week" && (
            <ol className="grid grid-cols-1 gap-3 md:grid-cols-7" data-guide="cal-grid">
              {days.map((d) => {
                const items = byDay.get(d) ?? [];
                const isToday = d === today;
                const past = d < today;
                const { "data-drop": _over, ...drop } = dropFor(d, past);
                return (
                  <li
                    key={d}
                    {...drop}
                    className={cn("flex min-h-[120px] flex-col rounded-[24px] p-2.5 transition-shadow md:min-h-[420px]", isToday ? "glass lime-ring" : "card-glass bg-card/50 hairline", dropKey === d && "ring-2 ring-[hsl(var(--lime))]")}
                    aria-label={fmt(keyDate(d), "UTC", { weekday: "long", month: "long", day: "numeric" })}>
                    <div className="mb-3 flex items-baseline justify-between px-1.5 pt-1">
                      <span className={cn("text-xs font-semibold uppercase tracking-[0.14em]", isToday ? "text-foreground" : "text-muted-foreground")}>{fmt(keyDate(d), "UTC", { weekday: "short" })}</span>
                      <span className={cn("tabular-nums grid h-8 w-8 place-items-center rounded-full text-sm font-semibold", isToday && "lime-bg")}>{fmt(keyDate(d), "UTC", { day: "numeric" })}</span>
                    </div>
                    <div className="flex flex-1 flex-col gap-2">
                      {items.map((p) => (
                        <PostCard key={p.id} post={p} status={statusOf(p)} tz={tz} variant="tile" onOpen={openPost} dragging={dragId === p.id} onDragStart={dragStart} onDragEnd={dragEnd} />
                      ))}
                      {!past && items.length === 0 && ready && (
                        <Link href="/create" className="group mt-auto flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border text-xs text-muted-foreground transition-colors [@media(hover:hover)]:hover:border-foreground/30 [@media(hover:hover)]:hover:text-foreground md:flex-1">
                          <Plus className="h-3.5 w-3.5" /> Plan something
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {view === "day" && <DayView {...cards} posts={byDay.get(anchor) ?? []} past={anchor < today} loading={!ready} />}
          {view === "month" && <MonthView {...cards} days={days} month={anchor.slice(0, 7)} today={today} byDay={byDay} dropFor={dropFor} dragId={dragId} onDragStart={dragStart} onDragEnd={dragEnd} onPickDay={(d) => (setDir(0), setAnchor(d), setView("day"))} />}
          {view === "upcoming" && <UpcomingList {...cards} posts={upcoming} hasMore={!!up.nextCursor} loading={upBusy || (!up.loaded && !upError)} error={upError} onMore={() => loadUpcoming(upError && !up.loaded ? null : up.nextCursor)} />}
        </motion.div>
      </AnimatePresence>

      {(view === "week" || view === "month") && weekCount > 0 && <p className="mt-4 hidden text-xs text-muted-foreground md:block">Drag a booked post to another day to move it. It keeps its time, and you confirm before anything saves. Open a post to pick an exact time.</p>}

      <DraftsTray {...cards} posts={drafts.posts} hasMore={!!drafts.nextCursor} loading={draftBusy} onMore={moreDrafts} />

      <PostSheet
        post={open}
        attention={open ? attentionFor(open, accounts) : undefined}
        onClose={() => setOpen(null)}
        onChange={(np) => setOpen(upsert(np))}
        onRemove={removeLocal}
        onRestore={(p) => void upsert(p)}
        onDuplicate={(np) => setOpen(upsert(np))}
      />
      <MoveDialog
        post={moving?.post ?? null}
        at={moving?.at ?? null}
        onClose={() => setMoving(null)}
        onMoved={(np) => {
          const full = upsert(np);
          setMoving(null);
          if (open?.id === full.id) setOpen(full);
          toast(full.scheduledAt ? `Moved to ${fmt(full.scheduledAt, tz, { weekday: "long", hour: "numeric", minute: "2-digit" })} ${tzShort(tz)}.` : "Saved.");
        }}
      />
    </div>
  );
}
