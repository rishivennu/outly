"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D } from "@/components/brand/Icon3D";
import { PlatformOrb, PLATFORM_HALO } from "@/components/shared/PlatformIcon";
import { cachedApi, lastWriteAt, peekCached } from "@/lib/client/api";
import { isStale } from "@/lib/client/preload";
import { useTabMemory } from "@/lib/client/tab-state";
import { warmApi, whenIdle } from "@/lib/client/warm";
import { PLATFORMS, PLATFORM_META } from "@/lib/domain";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { cn, compact } from "@/lib/utils";
import type { AnalyticsSummary } from "@/lib/analytics";
import type { Platform } from "@/lib/domain";
import { AnimatedNumber } from "@/components/shared/AnimatedNumber";
import { chartMotion, riseIndex } from "@/lib/motion/numbers";
import { LiveStrip } from "./LiveStrip";
import { ProfileReview } from "./ProfileReview";
import { AccountDrill, ReportButtons } from "./AccountDrill";
import { Standouts } from "./Standouts";
import { Compare } from "./Compare";
import { combinedNote, DAY_MS, dayKey, headline as buildHeadline, kpiMetrics, METRIC_TITLE, rangeLabel } from "@/lib/analytics/core";

const RANGES = [
  { d: 7, label: "7 days", phrase: "this week" },
  { d: 30, label: "30 days", phrase: "this month" },
  { d: 90, label: "90 days", phrase: "these last three months" },
  // 1096: longer history on the plans that include it (Creator 1 year, Agency 2 years).
  { d: 180, label: "6 months", phrase: "these last six months" },
  { d: 365, label: "1 year", phrase: "this past year" },
  { d: 730, label: "2 years", phrase: "these last two years" },
];

/** Page frame: one readable width, so a 1760px screen doesn't stretch every row edge to edge. The top padding
 * lives on the tab bar above (analytics/layout.tsx, 1065), which stays put while the views under it change. */
const FRAME = "page-frame pb-20";

/** 1140: what the trend chart draws. Followers come from Outlly's own daily snapshots, never from a guess. */
const CHART_METRICS = [
  { k: "views", label: "Views" },
  { k: "engagement", label: "Engagement" },
  { k: "followers", label: "Followers" },
] as const;
type ChartMetric = (typeof CHART_METRICS)[number]["k"];

type Custom = { from: string; to: string };

/** Your own dates. The inputs cannot reach past the history your plan keeps, so a range is never half empty. */
function CustomRange({ value, maxDays, onApply, onClear }: { value: Custom | null; maxDays: number; onApply: (c: Custom) => void; onClear: () => void }) {
  const today = dayKey(Date.now());
  const earliest = dayKey(Date.now() - (maxDays - 1) * DAY_MS);
  const [from, setFrom] = useState(value?.from ?? dayKey(Date.now() - 29 * DAY_MS));
  const [to, setTo] = useState(value?.to ?? today);
  const bad = !from || !to || to < from;
  const field = "mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return (
    <form
      className="glass mt-4 w-full flex-wrap items-end gap-3 rounded-[22px] p-4 flex"
      onSubmit={(e) => {
        e.preventDefault();
        if (!bad) onApply({ from, to });
      }}
    >
      <label className="text-sm">
        <span className="block text-muted-foreground">From</span>
        <input type="date" value={from} min={earliest} max={today} onChange={(e) => setFrom(e.target.value)} className={field} />
      </label>
      <label className="text-sm">
        <span className="block text-muted-foreground">To</span>
        <input type="date" value={to} min={earliest} max={today} onChange={(e) => setTo(e.target.value)} className={field} />
      </label>
      <Button type="submit" variant="lime" disabled={bad}>Apply</Button>
      {value && <Button type="button" variant="outline" onClick={onClear}>Clear</Button>}
      <p className="w-full text-sm text-muted-foreground">
        {bad ? "Pick a start date on or before the end date." : `Your plan keeps ${maxDays} days of history, so dates before ${earliest} are not available.`}
      </p>
    </form>
  );
}

function RangePicker({ value, onPick, maxDays, custom, onCustom }: { value: number; onPick: (d: number) => void; maxDays: number; custom: boolean; onCustom: () => void }) {
  const shown = RANGES.filter((r) => r.d <= maxDays);
  return (
    <div role="radiogroup" aria-label="Time range" className="flex shrink-0 flex-wrap gap-1 rounded-full bg-secondary/60 p-1 hairline">
      {shown.map((r) => (
        <button key={r.d} type="button" role="radio" aria-checked={!custom && value === r.d} onClick={() => onPick(r.d)} className={cn("relative h-11 rounded-full px-3 text-sm font-medium focus-visible:outline sm:px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", !custom && value === r.d ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {!custom && value === r.d && <motion.span layoutId="range" className="absolute inset-0 rounded-full bg-background shadow-sm" />}
          <span className="relative">{r.label}</span>
        </button>
      ))}
      {/* 1140: your own two dates, inside the same plan window as the presets. */}
      <button type="button" role="radio" aria-checked={custom} onClick={onCustom} className={cn("relative h-11 rounded-full px-3 text-sm font-medium focus-visible:outline sm:px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", custom ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
        {custom && <motion.span layoutId="range" className="absolute inset-0 rounded-full bg-background shadow-sm" />}
        <span className="relative">Custom</span>
      </button>
      {maxDays < 365 && (
        <Link href="/billing" aria-label="More history" className="inline-flex h-11 items-center rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-4">
          {/* 1099: the short label keeps the four options on one row on a 360px phone */}
          <span className="sm:hidden">More</span>
          <span className="hidden sm:inline">More history</span>
        </Link>
      )}
    </div>
  );
}

/** renderedAt: when the server built this page; a copy prefetched from the nav (1039) can be a while old. */
export function AnalyticsView({ initial, connected, focusAccount = null, renderedAt, maxDays = 90, reports = { csv: true, pdf: true } }: { initial: AnalyticsSummary; connected: Partial<Record<Platform, boolean>>; focusAccount?: string | null; renderedAt?: number; maxDays?: number; reports?: { csv: boolean; pdf: boolean } }) {
  const url = (d: number, acct: string | null, c: Custom | null = null) => `/api/analytics?days=${d}${c ? `&from=${c.from}&to=${c.to}` : ""}${acct ? `&account=${encodeURIComponent(acct)}` : ""}`;
  // 1114: the range and account you left Analytics on come back with you from another tab (a ?account= link wins).
  // A kept range paints in the first frame when its numbers are still remembered, else it loads like a click.
  const kept = useTabMemory<{ d: number; acct: string | null }>("analytics", (v) => {
    const o = v as { d?: unknown; acct?: unknown } | null;
    return o && typeof o.d === "number" && RANGES.some((r) => r.d === o.d) && o.d <= maxDays && (o.acct === null || (typeof o.acct === "string" && o.acct.length <= 64)) ? (o as { d: number; acct: string | null }) : null;
  });
  const start = focusAccount ? null : kept.saved;
  const [data, setData] = useState(() => (start && !start.acct && start.d !== initial.rangeDays ? (peekCached<AnalyticsSummary>(url(start.d, null)) ?? initial) : initial));
  const reduce = useReducedMotion();
  const live = useLivePlatforms();
  const [loading, setLoading] = useState(false);
  const preset = RANGES.find((r) => r.d === data.rangeDays) ?? RANGES[1];
  // 1140: a custom range names its own dates, so the headline and the chart label say exactly what they cover.
  const range = data.window.custom ? { ...preset, phrase: `from ${rangeLabel(data.window)}` } : preset;

  // 1037 drilldown: the combined list is remembered so picking one account never hides the others.
  const [drill, setDrill] = useState<string | null>(null);
  const [accounts, setAccounts] = useState(data.byAccount);
  // 1140: your own dates, and which metric the chart draws. Both only re-cut numbers that are already here.
  const [custom, setCustom] = useState<Custom | null>(null);
  const [openCustom, setOpenCustom] = useState(false);
  const [metric, setMetric] = useState<ChartMetric>("views");
  const { save } = kept;
  useEffect(() => save({ d: data.rangeDays, acct: drill }), [data.rangeDays, drill, save]);
  const load = async (d: number, acct: string | null, quiet = false, c: Custom | null = null) => {
    if (!quiet) setLoading(true);
    try {
      // Ranges are warmed once the page is idle (below), so switching is usually instant.
      const next = await cachedApi<AnalyticsSummary>(url(d, acct, c), quiet ? 0 : 60_000);
      setData(next);
      // Only keep the custom dates when the server actually honoured them (it clamps to the plan window).
      setCustom(next.window.custom ? c : null);
      // The API ignores an id this person can't see, so only show the drill when it actually applied.
      setDrill(acct && next.byAccount.some((a) => a.accountId === acct) ? acct : null);
      if (!acct) setAccounts(next.byAccount);
    } finally {
      setLoading(false);
    }
  };
  // A spike alert links here with ?account=; open on that account (the API re-checks it belongs to you).
  useEffect(() => {
    // Not limited to the current list: the link may be for another profile than the one picked on Home.
    if (focusAccount) void load(initial.rangeDays, focusAccount).catch(() => {});
    // 1114: a kept range or account that the first frame couldn't show yet.
    else if (start && (start.acct || start.d !== data.rangeDays)) {
      void load(start.d, start.acct).catch(() => {});
      // The account list beside a drill is the whole range's.
      if (start.acct && start.d !== initial.rangeDays) void cachedApi<AnalyticsSummary>(url(start.d, null)).then((n) => setAccounts(n.byAccount)).catch(() => {});
    }
    // A copy from the background preload may be a minute or two old, or from before a change made in this tab:
    // update it quietly (1039, 1114: judged on the server's clock).
    else if (isStale(renderedAt, 30_000, lastWriteAt())) void load(data.rangeDays, null, true).catch(() => {});
    // The other ranges, so a switch doesn't wait on the server. 1114: not with nothing connected (no numbers to switch).
    if (!Object.values(connected).some(Boolean)) return;
    return whenIdle(() => RANGES.forEach((r) => r.d !== initial.rangeDays && r.d <= Math.min(maxDays, 90) && warmApi(url(r.d, null))), 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pick = (d: number) => (d === data.rangeDays && !custom ? undefined : load(d, drill));
  const pickAccount = (id: string | null) => (id === drill ? undefined : load(data.rangeDays, id, false, custom));
  const applyCustom = (c: Custom) => load(data.rangeDays, drill, false, c);
  const clearCustom = () => {
    setOpenCustom(false);
    return load(data.rangeDays, drill);
  };

  const anyConnected = Object.values(connected).some(Boolean);
  // Brand-new studio: nothing connected and nothing published. A review and live counter would only
  // shimmer at zero, so show the one thing that unlocks this page instead.
  if (!data.hasData && !anyConnected) {
    return (
      // No tab bar on this screen: the layout's bar hides itself when it finds data-analytics-empty (globals.css).
      <div className={cn(FRAME, "pt-8 lg:pt-12")} data-analytics-empty="">
        <div className="flex min-h-[60dvh] flex-col items-center justify-center text-center">
          <Icon3D name="analytics" size={104} className="animate-bob mb-7" />
          <h1 className="display text-[clamp(2.2rem,5vw,3.2rem)]">Connect a place to see your numbers.</h1>
          <p className="mt-3 max-w-md text-muted-foreground">
            Link an account like Instagram or YouTube and its views show up here live. Once you publish through Outlly, this page compares how each post did everywhere it went.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="lime" size="lg">
              <Link href="/accounts">Connect an account</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/create">
                <Plus className="h-5 w-5" aria-hidden="true" /> Make your first one
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!data.hasData) {
    return (
      <div className={FRAME}>
        {/* Still the page's h1, but a slim card: the live numbers below are the real content here. */}
        <section aria-labelledby="insight" className="glass mt-8 flex flex-col gap-5 rounded-[28px] p-6 sm:flex-row sm:items-center sm:p-8">
          <Icon3D name="analytics" size={72} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 id="insight" className="display text-[clamp(1.8rem,3.2vw,2.5rem)]">Nothing published through Outlly yet.</h1>
            <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">Your accounts&apos; own numbers are live below. Once you publish from here, this page compares how each post did everywhere it went.</p>
          </div>
          <Button asChild variant="lime" size="lg" className="shrink-0">
            <Link href="/create">
              <Plus className="h-5 w-5" aria-hidden="true" /> Make your first one
            </Link>
          </Button>
        </section>
        <LiveStrip connected={connected} />
        <ProfileReview />
      </div>
    );
  }

  const change = data.previous.views ? ((data.totals.views - data.previous.views) / data.previous.views) * 100 : null;
  const best = [...data.byPlatform].sort((a, b) => b.views - a.views)[0];
  const landed = data.byPlatform.filter((b) => b.views > 0);
  const shownP = landed.length ? landed : data.byPlatform.filter((b) => b.connected);
  const quiet = landed.length ? data.byPlatform.filter((b) => b.views <= 0 && b.connected) : [];
  // 1140: a platform you have not linked is listed as not connected, with the way to fix it, never as a zero.
  const offline = data.byPlatform.filter((b) => !b.connected && b.views <= 0);
  const maxP = Math.max(...shownP.map((b) => b.views), 1);
  // The chart draws what the data holds, plus whatever is live, so a platform switched on mid-range is never
  // left out of a total it is already part of.
  const drawn = PLATFORMS.filter((p) => live.includes(p) || data.byPlatform.some((b) => b.platform === p && b.views > 0));
  const names = (xs: { platform: Platform }[]) => {
    const n = xs.map((x) => PLATFORM_META[x.platform].name);
    return n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n[0];
  };
  const nameOf = (p: string) => ({ platform: p, name: PLATFORM_META[p as Platform]?.name ?? p });

  // 1140 KPI cards: only the metrics the platforms in view actually report, and a note saying what is
  // counted and what is left out. A platform with no per-post reader never contributes a zero.
  const active = data.byPlatform.filter((b) => b.reader && (b.posts > 0 || b.views > 0)).map((b) => b.platform);
  const cards = kpiMetrics(active.length ? active : data.byPlatform.filter((b) => b.reader && b.connected).map((b) => b.platform));
  const counted = cards.length ? cards[cards.length - 1].from : [];
  const leftOut = [...new Set(cards.flatMap((c) => c.missing))];
  const note = combinedNote(counted.map(nameOf), leftOut.map(nameOf));

  const drilled = drill ? (accounts.find((a) => a.accountId === drill) ?? null) : null;
  // The headline is chosen from the numbers themselves (lib/analytics/core headline), so it never claims
  // growth that the snapshots do not hold.
  const head = buildHeadline({
    views: data.totals.views,
    previousViews: data.previous.views,
    followerGain: (() => {
      const best2 = data.followerHistory
        .filter((h) => h.points.length >= 2)
        .map((h) => ({ h, gain: h.points[h.points.length - 1].value - h.points[0].value }))
        .sort((a, b) => b.gain - a.gain)[0];
      return best2 && best2.gain > 0 ? { platform: best2.h.platform, name: PLATFORM_META[best2.h.platform].name, metric: best2.h.metric, gain: best2.gain } : null;
    })(),
    bestPlatform: best && best.views > 0 ? { platform: best.platform, name: PLATFORM_META[best.platform].name } : null,
    bestDay: data.bestDay,
    posts: data.byPlatform.reduce((n, b) => n + b.posts, 0),
    rangePhrase: range.phrase,
    accountName: drilled ? `@${drilled.username.replace(/^@/, "")}` : null,
  });

  // Follower history, one line per account: never one summed line, because each platform counts its own way.
  const follow = (() => {
    const lines = data.followerHistory.filter((h) => h.points.length >= 2);
    const days = [...new Set(lines.flatMap((h) => h.points.map((p) => p.date)))].sort();
    const rows = days.map((date) => {
      const row: Record<string, string | number | null> = { date };
      for (const h of lines) row[h.accountId] = h.points.find((p) => p.date === date)?.value ?? null;
      return row;
    });
    return { lines, rows };
  })();
  const chartLabel =
    metric === "views"
      ? `Daily views by platform over ${range.label}. Total ${compact(data.totals.views)}.`
      : metric === "engagement"
        ? `Interactions per view each day over ${range.label}. Days with no views are left blank.`
        : `Follower count per account over ${range.label}.`;

  return (
    <div className={cn(FRAME, "transition-opacity", loading && "opacity-60")} aria-busy={loading}>
      {/* The human headline comes first and is the page's h1. The range picker sits with it because it
          changes exactly these numbers. */}
      <header className="mt-10 flex flex-wrap items-end justify-between gap-6">
        <section aria-labelledby="insight" className="min-w-0 max-w-4xl">
          <p className="text-sm font-semibold text-muted-foreground">Published through Outlly</p>
          <h1 id="insight" className="display mt-2 text-[clamp(2.2rem,4.8vw,4.25rem)]">
            {head.variant === "views" ? (
              <>
                {head.before}<span className="energy-text"><AnimatedNumber value={data.totals.views} tier="main" id="analytics:reach" /></span> views {range.phrase}.
              </>
            ) : (
              <>
                {head.before}
                {head.value !== null && <span className="energy-text"><AnimatedNumber value={head.value} tier="main" id="analytics:headline" /></span>}
                {head.after}
              </>
            )}
          </h1>
          <ul className="mt-4 flex flex-wrap gap-x-7 gap-y-2 text-base text-muted-foreground">
            {head.notes.map((n, i) => (
              <li key={n} className="flex items-center gap-1.5">
                {i === 0 && change !== null && (change >= 0 ? <ArrowUpRight className="h-5 w-5 text-success" aria-hidden="true" /> : <ArrowDownRight className="h-5 w-5 text-warning" aria-hidden="true" />)}
                {n}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            Covering {rangeLabel(data.window)}.{data.window.clamped ? ` Your plan keeps ${maxDays} days of history, so the range was trimmed to fit.` : ""}
          </p>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          <RangePicker value={data.rangeDays} onPick={pick} maxDays={maxDays} custom={!!custom} onCustom={() => setOpenCustom((v) => !v)} />
          <ReportButtons days={data.rangeDays} from={custom?.from ?? null} to={custom?.to ?? null} account={drill} csv={reports.csv} pdf={reports.pdf} />
        </div>
        {(openCustom || custom) && <CustomRange value={custom} maxDays={maxDays} onApply={applyCustom} onClear={clearCustom} />}
      </header>

      {/* The cards rise in themselves (.kpi-in), so the page entrance moves this row as one block. */}
      <dl className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c, i, all) => (
          <div key={c.metric} className={cn("kpi-in glass rounded-[22px] p-5", i === all.length - 1 && all.length % 2 === 1 && "col-span-2 sm:col-span-1")} style={riseIndex(i)}>
            <dt className="text-sm text-muted-foreground">{METRIC_TITLE[c.metric]}</dt>
            <dd className="mt-1.5 text-[clamp(1.75rem,2.4vw,2.25rem)] font-semibold leading-none tracking-tight">
              <AnimatedNumber value={c.metric === "engagement" ? data.totals.engagement : data.totals[c.metric]} format={c.metric === "engagement" ? "pct" : "compact"} id={`analytics:${METRIC_TITLE[c.metric]}`} />
            </dd>
            {c.missing.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Not reported by {names(c.missing.map((p) => ({ platform: p as Platform })))}</p>}
          </div>
        ))}
      </dl>
      {/* Says what the combined numbers add up, and what they leave out. */}
      <p className="mt-3 text-sm text-muted-foreground">{note}</p>

      <AccountDrill accounts={accounts} active={drill} onPick={pickAccount} busy={loading} />

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <section aria-labelledby="trend" className="glass flex flex-col rounded-[28px] p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="trend" className="text-lg font-semibold">{metric === "views" ? "Views over time" : metric === "engagement" ? "Engagement over time" : "Followers over time"}</h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {/* 1140: the same window, a different measure. Nothing is refetched, so switching is instant. */}
              <div role="radiogroup" aria-label="Chart metric" className="flex gap-1 rounded-full bg-secondary/60 p-1 hairline">
                {CHART_METRICS.map((m) => (
                  <button key={m.k} type="button" role="radio" aria-checked={metric === m.k} onClick={() => setMetric(m.k)} className={cn("relative h-11 rounded-full px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", metric === m.k ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {metric === m.k && <motion.span layoutId="chart-metric" className="absolute inset-0 rounded-full bg-background shadow-sm" />}
                    <span className="relative">{m.label}</span>
                  </button>
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {metric === "followers"
                  ? follow.lines.map((h) => (
                      <li key={h.accountId} className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLATFORM_HALO[h.platform] }} aria-hidden="true" /> @{h.username.replace(/^@/, "")}
                        <span className="sr-only"> {h.metric}</span>
                      </li>
                    ))
                  : drawn.map((p) => (
                      <li key={p} className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLATFORM_HALO[p] }} aria-hidden="true" /> {PLATFORM_META[p].name}
                      </li>
                    ))}
              </ul>
            </div>
          </div>
          {/* Grows with the card next to it, so the chart never floats in an empty box. */}
          <div className="h-[300px] lg:h-auto lg:min-h-[300px] lg:flex-1" role="img" aria-label={chartLabel}>
            {metric === "views" ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                <defs>
                  {drawn.map((p) => (
                    <linearGradient key={p} id={`g-${p}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PLATFORM_HALO[p]} stopOpacity={0.38} />
                      <stop offset="100%" stopColor={PLATFORM_HALO[p]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 13 }} tickFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })} minTickGap={32} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 13 }} tickFormatter={(n: number) => compact(n)} width={52} />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--foreground) / 0.2)" }}
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 16, fontSize: 13, boxShadow: "var(--glass-shadow)", color: "hsl(var(--popover-foreground))" }}
                  itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                  labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                  labelFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  formatter={(v: number, n: string) => [compact(v), PLATFORM_META[n as keyof typeof PLATFORM_META]?.name ?? n]}
                />
                {drawn.map((p, i) => (
                  <Area {...chartMotion(reduce, i)} key={p} type="monotone" dataKey={p} stackId="1" stroke={PLATFORM_HALO[p]} strokeWidth={2} fill={`url(#g-${p})`} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
            ) : metric === "engagement" ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.engagementSeries} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 13 }} tickFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })} minTickGap={32} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 13 }} tickFormatter={(n: number) => `${n.toFixed(0)}%`} width={52} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 16, fontSize: 13, boxShadow: "var(--glass-shadow)", color: "hsl(var(--popover-foreground))" }}
                    labelFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    formatter={(v: number) => [`${v.toFixed(1)}%`, "Engaged"]}
                  />
                  {/* connectNulls stays off: a day with no views has no engagement rate, so the line breaks. */}
                  <Line type="monotone" dataKey="value" connectNulls={false} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : follow.lines.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={follow.rows} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 13 }} tickFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })} minTickGap={32} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 13 }} tickFormatter={(n: number) => compact(n)} width={52} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 16, fontSize: 13, boxShadow: "var(--glass-shadow)", color: "hsl(var(--popover-foreground))" }}
                    labelFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    formatter={(v: number, n: string) => [compact(v), follow.lines.find((h) => h.accountId === n)?.username ?? n]}
                  />
                  {follow.lines.map((h) => (
                    <Line key={h.accountId} type="monotone" dataKey={h.accountId} connectNulls={false} stroke={PLATFORM_HALO[h.platform]} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              /* Honest empty state: no invented zeroes, just what is missing and when it will be there. */
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <p className="text-base font-medium">No follower history yet.</p>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">Outlly saves one follower count a day for each connected account. This chart appears once there are two days to compare, so nothing here has to be guessed.</p>
              </div>
            )}
          </div>
        </section>

        <div className="grid content-start gap-3">
          <section aria-labelledby="where" className="glass rounded-[28px] p-6">
            <div className="mb-5 flex items-baseline justify-between gap-3">
              <h2 id="where" className="text-lg font-semibold">Where it landed</h2>
              <span className="text-sm text-muted-foreground" aria-hidden="true">Views / engaged</span>
            </div>
            <ul className="space-y-4">
              {shownP.map((b, i) => (
                <li key={b.platform}>
                  {/* 1140: each row opens that platform's own dashboard. */}
                  <Link href={`/analytics/${b.platform}`} className="block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={`${PLATFORM_META[b.platform].name} dashboard`}>
                  <div className="mb-1.5 flex items-center gap-2.5 text-[15px]">
                    <PlatformOrb platform={b.platform} size={26} />
                    <span className="font-medium">{PLATFORM_META[b.platform].name}</span>
                    <span className="tabular ml-auto font-semibold">{compact(b.views)}<span className="sr-only"> views</span></span>
                    <span className="tabular w-14 text-right text-muted-foreground">{b.engagement.toFixed(1)}%<span className="sr-only"> engaged</span></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                    <motion.div className="h-full rounded-full" style={{ background: PLATFORM_HALO[b.platform] }} initial={{ width: 0 }} animate={{ width: `${(b.views / maxP) * 100}%` }} transition={reduce ? { duration: 0 } : { delay: 0.2 + i * 0.08, duration: 0.7, ease: "easeInOut" }} />
                  </div>
                  </Link>
                </li>
              ))}
            </ul>
            {quiet.length > 0 && <p className="mt-5 border-t border-border/60 pt-4 text-sm text-muted-foreground">No views yet on {names(quiet)}.</p>}
            {offline.length > 0 && (
              <ul className="mt-5 space-y-1 border-t border-border/60 pt-4">
                {offline.map((b) => (
                  <li key={b.platform} className="flex items-center gap-2.5 text-[15px]">
                    <PlatformOrb platform={b.platform} size={26} />
                    <span className="font-medium">{PLATFORM_META[b.platform].name}</span>
                    <span className="text-sm text-muted-foreground">Not connected</span>
                    <Link href="/accounts" className="ml-auto inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-lime-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      Connect<span className="sr-only"> {PLATFORM_META[b.platform].name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm text-muted-foreground">Engaged is likes, comments and shares per view. Pick a platform for its own dashboard.</p>
          </section>

          {data.top && (
            <Link href="/content" className="group relative flex min-h-[170px] overflow-hidden rounded-[28px] p-6 hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {data.top.thumbnailUrl && <img src={data.top.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40 transition duration-700 group-hover:scale-105 dark:opacity-50" />}
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
              <div className="relative mt-auto">
                <p className="mb-2 text-sm font-semibold text-muted-foreground">Your standout</p>
                <p className="text-xl font-semibold leading-tight tracking-tight">{data.top.title}</p>
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <PlatformOrb platform={data.top.platform} size={20} /> {compact(data.top.views)} views on {PLATFORM_META[data.top.platform].name}
                </p>
              </div>
            </Link>
          )}
        </div>
      </div>

      <Standouts posts={data.standouts} avgViews={data.avgViews} />
      {!drill && <Compare accounts={accounts} />}
      <LiveStrip connected={connected} />
      <ProfileReview />
    </div>
  );
}
