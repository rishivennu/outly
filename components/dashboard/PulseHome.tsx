"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cachedApi, peekCached } from "@/lib/client/api";
import { useTabMemory } from "@/lib/client/tab-state";
import { cn } from "@/lib/utils";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { compact, isPulseRange, rate, total, type Pulse, type PulseRange } from "@/lib/dashboard/pulse-core";
import { pointsTrend, trend, TREND_LONG, TREND_SHORT, type Trend } from "@/lib/analytics/trend";
import { useEdgeFade } from "@/lib/client/edge-fade";
import { AnimIcon, useIconPlay } from "@/components/icons/animated";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { Thumb } from "@/components/shared/Thumb";
import { useEnter } from "./motion";
import { useSlider } from "./useSlider";
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

type Kpi = { key: string; icon: string; label: string; value: string; trend: Trend; zero: boolean; unit: "%" | "pts"; spark: number[]; hint: string };

/**
 * 1154: the comparison chip says only what the numbers can back. A period the platforms never synced, or one
 * Outlly wasn't counting yet, gets its reason in words (TREND_SHORT) instead of a fake -100%; a count that
 * truly fell to nothing says "None yet" rather than a percentage of nothing.
 */
function Delta({ t, unit, zero }: { t: Trend; unit: "%" | "pts"; zero: boolean }) {
  if (t.kind !== "change" || (zero && unit === "%")) {
    const word = t.kind === "change" ? "None yet" : TREND_SHORT[t.kind];
    const long = t.kind === "change" ? "Nothing in this period yet." : TREND_LONG[t.kind];
    return <span className="pulse-delta is-flat" title={long}><span aria-hidden="true">{word}</span><span className="sr-only">{long}</span></span>;
  }
  const r = Math.round(t.pct * 10) / 10;
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
      <p className="flex items-center gap-2.5 text-[14px] font-medium text-muted-foreground">
        <span className="pulse-ico"><AnimIcon name={k.icon} size={16} iconRef={ic.ref} /></span>
        <span className="truncate">{k.label}</span>
      </p>
      {/* 1154: two cards a row on a phone, so the line sits under the number there and beside it from sm up. */}
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <RollingNumber value={k.value} tier={k.key === "eng" ? "pct" : i === 0 ? "main" : "secondary"} className="font-display block text-[26px] font-bold tracking-tight tabular-nums min-[400px]:text-[30px] sm:text-[32px]" />
          <div className="mt-2 whitespace-nowrap"><Delta t={k.trend} unit={k.unit} zero={k.zero} /></div>
        </div>
        <div className="w-full shrink-0 sm:w-[44%] sm:max-w-[120px]">
          <Sparkline data={k.spark} tone={k.trend.kind !== "change" || k.zero || Math.abs(k.trend.pct) < 0.05 ? "flat" : k.trend.pct > 0 ? "up" : "down"} delay={i * 0.045} />
        </div>
      </div>
      <p className="sr-only">{k.hint}</p>
    </article>
  );
}

const rangeUrl = (r: number) => `/api/dashboard?days=${r}`;

export function PulseHome({ initial, firstName, canSwitch, nextPost, emptyArt = null }: { initial: Pulse; firstName: string; canSwitch: boolean; nextPost: { when: string; title: string } | null; emptyArt?: ReactNode }) {
  // 1114: the range and platform tab you left Home on come back with you from another tab. A kept range shows at
  // once when its numbers are still remembered from this visit's session, else it loads like a click on it.
  const kept = useTabMemory<{ range: PulseRange; tab: string }>("home:pulse", (v) => {
    const o = v as { range?: unknown; tab?: unknown } | null;
    return o && typeof o.range === "number" && isPulseRange(o.range) && typeof o.tab === "string" && o.tab.length < 40 ? (o as { range: PulseRange; tab: string }) : null;
  });
  const keptRange = kept.saved?.range ?? null;
  const [data, setData] = useState<Record<number, Pulse>>(() => {
    const hit = keptRange && keptRange !== initial.days ? peekCached<Pulse>(rangeUrl(keptRange)) : undefined;
    return hit ? { [initial.days]: initial, [keptRange as number]: hit } : { [initial.days]: initial };
  });
  const [range, setRange] = useState<PulseRange>(() => (keptRange && data[keptRange] ? keptRange : initial.days));
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState(kept.saved?.tab ?? "all");
  // A newer server render (the page bringing a preloaded copy up to date) replaces its range's numbers.
  const [from, setFrom] = useState(initial);
  if (from !== initial) {
    setFrom(initial);
    setData((x) => ({ ...x, [initial.days]: initial }));
  }
  const { save } = kept;
  useEffect(() => save({ range, tab }), [range, tab, save]);
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
      // 1114: remembered for a minute, so coming back to Home on this range paints it in its first frame.
      const d = await cachedApi<Pulse>(rangeUrl(r));
      setData((x) => ({ ...x, [r]: d }));
    } catch {
      setFailed(true);
      setRange(range);
    } finally {
      setLoading(false);
    }
  };
  // A kept range that wasn't remembered any more loads the way picking it does.
  useEffect(() => {
    if (keptRange && keptRange !== range) void pickRange(keptRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // 1154: platform numbers compare only when both periods were tracked (cov); posts are Outlly's own count.
    const cov = p.cov?.[key] ?? null;
    const per = p.periods ?? { curStart: Date.parse(`${p.dates[0]}T00:00:00Z`), prevStart: Date.parse(`${p.dates[0]}T00:00:00Z`) - p.days * 864e5 };
    const vt = trend(views, pViews, per, cov);
    // Only state the earlier number when it is a fair one to compare with.
    const vHint = vt.kind === "change" || vt.kind === "new" ? `${pViews.toLocaleString("en-US")} the period before.` : TREND_LONG[vt.kind];
    return [
      { key: "views", icon: "views", label: "Views", value: compact(views), trend: vt, zero: views === 0, unit: "%", spark: c.views, hint: vHint },
      { key: "inter", icon: "interactions", label: "Interactions", value: compact(inter), trend: trend(inter, pInter, per, cov), zero: inter === 0, unit: "%", spark: c.interactions, hint: "Likes, comments and shares." },
      { key: "eng", icon: "engagement", label: "Engagement", value: views ? `${er.toFixed(1)}%` : "0%", trend: pointsTrend(er, pEr, views, pViews, per, cov), zero: views === 0, unit: "pts", spark: engSpark, hint: "Interactions per hundred views." },
      { key: "posts", icon: "posts", label: "Posts sent", value: String(posts), trend: trend(posts, pPosts, per), zero: posts === 0, unit: "%", spark: c.posts, hint: `${pPosts} the period before.` },
    ];
  }, [c, v, p, key]);

  const tabsS = useSlider<HTMLDivElement>(`${key}|${tabs.join()}`);
  useEdgeFade(key, tabsS.box);
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
      requestAnimationFrame(() => requestAnimationFrame(() => bs.forEach((b, i) => { b.style.transition = reduced ? "none" : `transform 500ms cubic-bezier(.2,.8,.2,1) ${80 + i * 40}ms`; b.style.transform = ""; })));
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
    <div ref={root} data-enter-root className="page-frame pb-16 pt-6 lg:pt-8">
      <header data-enter className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="font-display truncate text-[24px] font-bold tracking-tight min-[400px]:text-[26px] sm:text-[32px]">Welcome back, {firstName || "there"}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[14px] text-muted-foreground sm:mt-1">
            <span className="pulse-status"><span className="pulse-status-dot" aria-hidden="true" />{nextPost ? `Next post ${nextPost.when}` : "Nothing booked yet"}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canSwitch && <DashboardSwitch current="pulse" className="min-w-0 flex-1 sm:flex-none" />}
          {/* The replay is a flourish; on a phone the row keeps its room for the two things you came to do. */}
          <button type="button" onClick={replay} {...replayIc.handlers} className="gbtn-icon ripple-host pulse-icon-btn max-sm:!hidden" aria-label="Replay the dashboard animation" title="Replay">
            <AnimIcon name="replay" size={18} iconRef={replayIc.ref} />
          </button>
          <Link href="/create" {...newIc.handlers} className="lime-glow inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-2xl bg-lime px-4 text-[15px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.96] [@media(hover:hover)]:hover:-translate-y-px">
            <AnimIcon name="plus" size={18} iconRef={newIc.ref} /> New post
          </Link>
        </div>
      </header>

      <div data-enter className="mt-4 flex flex-col-reverse gap-2 border-b border-border/70 sm:mt-6 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div ref={tabsS.box} role="tablist" aria-label="Platform" onKeyDown={onTabKey} className="edge-fade relative -mb-px flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" id={`pt-${t}`} aria-selected={t === key} aria-controls="pulse-panel" tabIndex={t === key ? 0 : -1} onClick={() => setTab(t)} className={cn("relative flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-t-xl px-3.5 text-[14px] font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", t === key ? "text-foreground" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground")}>
              {t !== "all" && <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: pcolor(t) }} />}
              {t === "all" ? "All platforms" : pname(t)}
            </button>
          ))}
          <span ref={tabsS.bar} aria-hidden="true" className="pulse-underline" />
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-start sm:pb-3">
          <div ref={rangeS.box} role="radiogroup" aria-label="Date range" onKeyDown={onRangeKey} className="pulse-seg gseg relative">
            <span ref={rangeS.bar} aria-hidden="true" className="pulse-seg-pill gseg-pane" />
            {RANGES.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={r === range} tabIndex={r === range ? 0 : -1} onClick={() => void pickRange(r)} className={cn("relative z-[1] h-11 min-w-[48px] rounded-[12px] px-2.5 text-[14px] tabular-nums font-semibold outline-none transition-[color,transform] duration-150 active:scale-[0.96] motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-[52px] sm:px-3", r === range ? "text-foreground" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground")}>
                {r}D
              </button>
            ))}
          </div>
          <p className="truncate text-right text-[13px] tabular-nums text-muted-foreground sm:text-left" aria-live="polite">{loading ? "Loading..." : fmtRange(p.dates)}</p>
        </div>
      </div>
      {failed && <p role="alert" className="mt-3 text-[14px] text-destructive">Couldn&apos;t load that range. Showing the last one; try again in a moment.</p>}

      <div id="pulse-panel" role="tabpanel" aria-labelledby={`pt-${key}`} className={cn("transition-opacity duration-300", loading && "opacity-60")}>
        <section aria-label="Key numbers" className="mt-4 grid grid-cols-2 gap-3 sm:mt-5 lg:grid-cols-4 lg:gap-4">
          {kpis.map((k, i) => <KpiCard key={k.key} k={k} i={i} />)}
        </section>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
          <section data-enter aria-labelledby="vot-h" className="pulse-card min-w-0 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="vot-h" className="text-[16px] font-semibold tracking-tight">Views over time</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{scopeLabel}, compared with the {range} days before</p>
              </div>
              <p className="flex items-center gap-4 text-[13px] text-muted-foreground" aria-hidden="true">
                <span className="flex items-center gap-1.5"><span className="pulse-key pulse-key-cur" />This period</span>
                <span className="flex items-center gap-1.5"><span className="pulse-key pulse-key-prev" />Before</span>
              </p>
            </div>
            <div className="relative mt-4">
              <ViewsChart cur={c.views} prev={v.views} dates={p.dates} days={range} label={`Views over time, ${scopeLabel}`} />
              {!p.hasData && (
                <div className="absolute inset-0 grid place-items-center">
                  <div className={`pulse-empty max-w-sm ${emptyArt ? "flex items-center gap-4 text-left" : "max-w-xs text-center"}`}>
                    {emptyArt}
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">Your numbers land here</p>
                      <p className="mt-1 text-[13px] text-muted-foreground">Once a post goes live, its views show up within a few hours.</p>
                      <Link href="/create" className="mt-3 inline-flex h-11 items-center rounded-2xl bg-secondary px-4 text-[14px] font-semibold hairline hover:bg-secondary/70">Create a post</Link>
                    </div>
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
                <p className="mt-6 rounded-2xl bg-secondary/40 p-4 text-[14px] text-muted-foreground">No views yet {key === "all" ? "in this range" : `on ${pname(key)} in this range`}.</p>
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
                          <span className="block text-xs text-muted-foreground">views</span>
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
                    <span className="flex items-center gap-2.5 text-[15px] font-semibold"><PlatformOrb platform={s.pl as Platform} size={28} square />{pname(s.pl)}</span>
                    <span className="text-[20px] font-bold tabular-nums">{share}%</span>
                  </span>
                  <span className="block h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
                    <span className="block h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${share}%`, background: pcolor(s.pl) }} />
                  </span>
                  <span className="grid grid-cols-3 gap-2 text-[13px] text-muted-foreground">
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
