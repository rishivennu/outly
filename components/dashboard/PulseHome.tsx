"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { compact, delta, rate, total, type Pulse, type PulseRange } from "@/lib/dashboard/pulse-core";
import { AnimIcon, useIconPlay } from "@/components/icons/animated";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { Thumb } from "@/components/shared/Thumb";
import { useEnter } from "./motion";
import { RollingNumber } from "./RollingNumber";
import { Sparkline } from "./Sparkline";
import { ViewsChart } from "./ViewsChart";
import { DashboardSwitch } from "@/components/home/DashboardSwitch";

const RANGES: PulseRange[] = [7, 30, 90];
const pname = (p: string) => PLATFORM_META[p as Platform]?.name ?? p;
const pcolor = (p: string) => `hsl(var(${PLATFORM_META[p as Platform]?.colorVar ?? "--lime"}))`;
const fmtRange = (dates: string[]) => {
  const f = (iso: string, y = false) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(y ? { year: "numeric" } : {}), timeZone: "UTC" });
  return dates.length ? `${f(dates[0])} to ${f(dates[dates.length - 1], true)}` : "";
};

type Kpi = { key: string; icon: string; label: string; value: string; change: number | null; unit: "%" | "pts"; spark: number[]; hint: string };

function Delta({ change, unit }: { change: number | null; unit: "%" | "pts" }) {
  if (change === null) return <span className="pulse-delta is-flat">New</span>;
  const r = Math.round(change * 10) / 10;
  const up = r > 0;
  const flat = r === 0;
  const txt = `${up ? "+" : ""}${r.toFixed(1)}${unit === "%" ? "%" : " pts"}`;
  return (
    <span className={cn("pulse-delta", flat ? "is-flat" : up ? "is-up" : "is-down")}>
      {!flat && (
        <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3"><path d={up ? "M3 9 9 3M4.5 3H9v4.5" : "M3 3l6 6M9 4.5V9H4.5"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
      <span className="sr-only">{flat ? "No change" : up ? "Up" : "Down"} </span>
      {flat ? "No change" : txt}
    </span>
  );
}

function KpiCard({ k, i }: { k: Kpi; i: number }) {
  const ic = useIconPlay();
  return (
    <article data-enter {...ic.handlers} className="pulse-card group flex min-w-0 flex-col gap-3 p-4 sm:p-5" aria-label={`${k.label}: ${k.value}`}>
      <p className="flex items-center gap-2.5 text-[13.5px] font-medium text-muted-foreground">
        <span className="pulse-ico"><AnimIcon name={k.icon} size={16} iconRef={ic.ref} /></span>
        <span className="truncate">{k.label}</span>
      </p>
      <div className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <RollingNumber value={k.value} className="font-display block text-[30px] font-bold tracking-tight sm:text-[32px]" />
          <div className="mt-2"><Delta change={k.change} unit={k.unit} /></div>
        </div>
        <div className="w-[44%] max-w-[120px] shrink-0 max-[420px]:w-[40%]">
          <Sparkline data={k.spark} tone={k.change === null || Math.abs(k.change) < 0.05 ? "flat" : k.change > 0 ? "up" : "down"} delay={i * 0.045} />
        </div>
      </div>
      <p className="sr-only">{k.hint}</p>
    </article>
  );
}

/** Tabs and segmented controls share one sliding indicator: measured, then moved with a CSS transform. */
function useSlider<T extends HTMLElement>(dep: unknown) {
  const box = useRef<T>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const place = useCallback(() => {
    const b = box.current;
    const el = b?.querySelector<HTMLElement>('[aria-selected="true"],[aria-checked="true"]');
    if (!b || !el || !bar.current) return;
    bar.current.style.width = `${el.offsetWidth}px`;
    bar.current.style.transform = `translate3d(${el.offsetLeft}px,0,0)`;
    bar.current.style.opacity = "1";
  }, []);
  useLayoutEffect(place, [dep, place]);
  useEffect(() => {
    const ro = new ResizeObserver(place);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [place]);
  return { box, bar };
}

export function PulseHome({ initial, firstName, canSwitch, nextPost }: { initial: Pulse; firstName: string; canSwitch: boolean; nextPost: { when: string; title: string } | null }) {
  const [range, setRange] = useState<PulseRange>(initial.days);
  const [data, setData] = useState<Record<number, Pulse>>({ [initial.days]: initial });
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState("all");
  const { root, replay } = useEnter<HTMLDivElement>();
  const replayIc = useIconPlay();
  const newIc = useIconPlay();
  const p = data[range] ?? data[initial.days];

  const pickRange = async (r: PulseRange) => {
    setRange(r);
    if (data[r]) return;
    setLoading(true);
    setFailed(false);
    try {
      const d = await api<Pulse>(`/api/dashboard?days=${r}`);
      setData((x) => ({ ...x, [r]: d }));
    } catch {
      setFailed(true);
      setRange(range);
    } finally {
      setLoading(false);
    }
  };

  const tabs = ["all", ...p.platforms];
  const key = tabs.includes(tab) ? tab : "all";
  const c = p.cur[key];
  const v = p.prev[key];
  const kpis: Kpi[] = useMemo(() => {
    const views = total(c.views), pViews = total(v.views);
    const inter = total(c.interactions), pInter = total(v.interactions);
    const posts = total(c.posts), pPosts = total(v.posts);
    const er = rate(inter, views), pEr = rate(pInter, pViews);
    const engSpark = c.views.map((x, i) => rate(c.interactions[i], x));
    return [
      { key: "views", icon: "views", label: "Views", value: compact(views), change: delta(views, pViews), unit: "%", spark: c.views, hint: `${pViews.toLocaleString("en-US")} the period before.` },
      { key: "inter", icon: "interactions", label: "Interactions", value: compact(inter), change: delta(inter, pInter), unit: "%", spark: c.interactions, hint: "Likes, comments and shares." },
      { key: "eng", icon: "engagement", label: "Engagement", value: `${er.toFixed(1)}%`, change: pViews ? er - pEr : null, unit: "pts", spark: engSpark, hint: "Interactions per hundred views." },
      { key: "posts", icon: "posts", label: "Posts sent", value: String(posts), change: delta(posts, pPosts), unit: "%", spark: c.posts, hint: `${pPosts} the period before.` },
    ];
  }, [c, v]);

  const tabsS = useSlider<HTMLDivElement>(`${key}|${tabs.join()}`);
  const rangeS = useSlider<HTMLDivElement>(range);
  const top = p.top[key] ?? [];
  const topMax = Math.max(1, ...top.map((t) => t.views));
  const split = p.platforms.map((pl) => ({ pl, views: total(p.cur[pl].views), posts: total(p.cur[pl].posts), inter: total(p.cur[pl].interactions) }));
  const splitAll = Math.max(1, split.reduce((a, s) => a + s.views, 0));

  // Bars grow from zero each time their list changes (or the dashboard replays).
  const bars = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bars.current;
    if (!el) return;
    const grow = () => {
      const bs = [...el.querySelectorAll<HTMLElement>("[data-bar]")];
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      bs.forEach((b) => { b.style.transition = "none"; b.style.transform = reduced ? "" : "scaleX(0)"; });
      requestAnimationFrame(() => requestAnimationFrame(() => bs.forEach((b, i) => { b.style.transition = reduced ? "none" : `transform 800ms cubic-bezier(.2,.8,.2,1) ${200 + i * 70}ms`; b.style.transform = ""; })));
    };
    grow();
    const r = root.current;
    r?.addEventListener("pulse:enter", grow);
    return () => r?.removeEventListener("pulse:enter", grow);
  }, [key, range, root]);

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = tabs.indexOf(key);
    const to = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(tabs[to]);
    (e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[to])?.focus();
  };
  const onRangeKey = (e: React.KeyboardEvent) => {
    const i = RANGES.indexOf(range);
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % 3 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i + 2) % 3 : -1;
    if (to < 0) return;
    e.preventDefault();
    void pickRange(RANGES[to]);
    (e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[to])?.focus();
  };
  const scopeLabel = key === "all" ? "All platforms" : pname(key);

  return (
    <div ref={root} data-enter-root className="mx-auto max-w-6xl px-5 pb-16 pt-6 sm:px-10 lg:pt-8">
      <header data-enter className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[28px] font-bold tracking-tight sm:text-[32px]">Welcome back, {firstName || "there"}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[14px] text-muted-foreground">
            <span className="pulse-status"><span className="pulse-status-dot" aria-hidden="true" />{nextPost ? `Next post ${nextPost.when}` : "Nothing booked yet"}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSwitch && <DashboardSwitch current="pulse" />}
          <button type="button" onClick={replay} {...replayIc.handlers} className="pulse-icon-btn" aria-label="Replay the dashboard animation" title="Replay">
            <AnimIcon name="replay" size={18} iconRef={replayIc.ref} />
          </button>
          <Link href="/create" {...newIc.handlers} className="lime-glow inline-flex h-11 items-center gap-2 rounded-2xl bg-lime px-4 text-[14.5px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-px active:scale-[0.98]">
            <AnimIcon name="plus" size={18} iconRef={newIc.ref} /> New post
          </Link>
        </div>
      </header>

      <div data-enter className="mt-6 flex flex-col gap-4 border-b border-border/70 sm:flex-row sm:items-end sm:justify-between">
        <div ref={tabsS.box} role="tablist" aria-label="Platform" onKeyDown={onTabKey} className="relative -mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" id={`pt-${t}`} aria-selected={t === key} aria-controls="pulse-panel" tabIndex={t === key ? 0 : -1} onClick={() => setTab(t)} className={cn("relative flex h-11 shrink-0 items-center gap-2 rounded-t-xl px-3.5 text-[14px] font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring", t === key ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {t !== "all" && <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: pcolor(t) }} />}
              {t === "all" ? "All platforms" : pname(t)}
            </button>
          ))}
          <span ref={tabsS.bar} aria-hidden="true" className="pulse-underline" />
        </div>
        <div className="flex items-center gap-3 pb-3">
          <div ref={rangeS.box} role="radiogroup" aria-label="Date range" onKeyDown={onRangeKey} className="pulse-seg relative">
            <span ref={rangeS.bar} aria-hidden="true" className="pulse-seg-pill" />
            {RANGES.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={r === range} tabIndex={r === range ? 0 : -1} onClick={() => void pickRange(r)} className={cn("relative z-[1] h-9 min-w-[52px] rounded-[10px] px-3 text-[13.5px] font-semibold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring", r === range ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {r}D
              </button>
            ))}
          </div>
          <p className="hidden text-[13px] text-muted-foreground md:block" aria-live="polite">{loading ? "Loading…" : fmtRange(p.dates)}</p>
        </div>
      </div>
      {failed && <p role="alert" className="mt-3 text-[13.5px] text-destructive">Couldn&apos;t load that range. Showing the last one; try again in a moment.</p>}

      <div id="pulse-panel" role="tabpanel" aria-labelledby={`pt-${key}`} className={cn("transition-opacity duration-300", loading && "opacity-60")}>
        <section aria-label="Key numbers" className="mt-5 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          {kpis.map((k, i) => <KpiCard key={k.key} k={k} i={i} />)}
        </section>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
          <section data-enter aria-labelledby="vot-h" className="pulse-card min-w-0 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="vot-h" className="text-[16px] font-semibold tracking-tight">Views over time</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{scopeLabel}, compared with the {range} days before</p>
              </div>
              <p className="flex items-center gap-4 text-[12.5px] text-muted-foreground" aria-hidden="true">
                <span className="flex items-center gap-1.5"><span className="pulse-key pulse-key-cur" />This period</span>
                <span className="flex items-center gap-1.5"><span className="pulse-key pulse-key-prev" />Before</span>
              </p>
            </div>
            <div className="relative mt-4">
              <ViewsChart cur={c.views} prev={v.views} dates={p.dates} days={range} label={`Views over time, ${scopeLabel}`} />
              {!p.hasData && (
                <div className="absolute inset-0 grid place-items-center">
                  <div className="pulse-empty max-w-xs text-center">
                    <p className="text-[14.5px] font-semibold">Your numbers land here</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">Once a post goes live, its views show up within a few hours.</p>
                    <Link href="/create" className="mt-3 inline-flex h-11 items-center rounded-2xl bg-secondary px-4 text-[13.5px] font-semibold hairline hover:bg-secondary/70">Create a post</Link>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section data-enter aria-labelledby="tp-h" className="pulse-card min-w-0 p-4 sm:p-5">
            <h2 id="tp-h" className="text-[16px] font-semibold tracking-tight">Top posts</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">By views in this period</p>
            <div ref={bars}>
              {top.length === 0 ? (
                <p className="mt-6 rounded-2xl bg-secondary/40 p-4 text-[13.5px] text-muted-foreground">No views yet {key === "all" ? "in this range" : `on ${pname(key)} in this range`}.</p>
              ) : (
                <ol className="mt-3 flex flex-col gap-1">
                  {top.map((t) => (
                    <li key={`${t.postId}-${t.platform}`}>
                      <Link href={`/content?post=${t.postId}`} className="flex min-h-[56px] items-center gap-3 rounded-2xl p-2 transition-colors duration-200 hover:bg-foreground/[0.04]">
                        <span className="relative shrink-0">
                          <Thumb src={t.thumbnailUrl} alt="" className="h-11 w-11 rounded-xl" playOnHover={false} />
                          <span className="absolute -bottom-1 -right-1"><PlatformOrb platform={t.platform as Platform} size={18} ring /></span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold">{t.title}</span>
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
                            <span data-bar className="pulse-bar block h-full origin-left rounded-full" style={{ width: `${Math.max(4, (t.views / topMax) * 100)}%` }} />
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[14px] font-bold tabular-nums">{compact(t.views)}</span>
                          <span className="block text-[11.5px] text-muted-foreground">views</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>

        {split.length > 0 && (
          <section aria-label="By platform" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {split.map((s) => {
              const share = Math.round((s.views / splitAll) * 100);
              return (
                <button key={s.pl} type="button" data-enter onClick={() => setTab(s.pl)} aria-pressed={key === s.pl} className={cn("pulse-card group flex flex-col gap-3 p-4 text-left outline-none transition-shadow duration-200 focus-visible:ring-2 focus-visible:ring-ring sm:p-5", key === s.pl && "ring-1 ring-foreground/25")}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2.5 text-[14.5px] font-semibold"><PlatformOrb platform={s.pl as Platform} size={28} square />{pname(s.pl)}</span>
                    <span className="text-[20px] font-bold tabular-nums">{share}%</span>
                  </span>
                  <span className="block h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
                    <span className="block h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${share}%`, background: pcolor(s.pl) }} />
                  </span>
                  <span className="grid grid-cols-3 gap-2 text-[12.5px] text-muted-foreground">
                    <span>Views<b className="block text-[14px] font-semibold text-foreground tabular-nums">{compact(s.views)}</b></span>
                    <span>Posts<b className="block text-[14px] font-semibold text-foreground tabular-nums">{s.posts}</b></span>
                    <span>Engagement<b className="block text-[14px] font-semibold text-foreground tabular-nums">{rate(s.inter, s.views).toFixed(1)}%</b></span>
                  </span>
                </button>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}
