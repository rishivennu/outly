"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D } from "@/components/brand/Icon3D";
import { PlatformOrb, PLATFORM_HALO } from "@/components/shared/PlatformIcon";
import { cachedApi } from "@/lib/client/api";
import { warmApi, whenIdle } from "@/lib/client/warm";
import { PLATFORM_META } from "@/lib/domain";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { cn, compact } from "@/lib/utils";
import type { AnalyticsSummary } from "@/lib/analytics";
import type { Platform } from "@/lib/domain";
import { PlatformTabs } from "./PlatformTabs";
import { LiveStrip } from "./LiveStrip";
import { ProfileReview } from "./ProfileReview";
import { AccountDrill, ReportButtons } from "./AccountDrill";

const RANGES = [
  { d: 7, label: "7 days", phrase: "this week" },
  { d: 30, label: "30 days", phrase: "this month" },
  { d: 90, label: "90 days", phrase: "these last three months" },
];

function CountUp({ value, format = compact, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) return setShown(value);
    const c = animate(0, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1], onUpdate: setShown });
    return () => c.stop();
  }, [inView, value, reduce]);
  return (
    <span ref={ref} className={cn("tabular", className)}>
      {format(shown)}
    </span>
  );
}

/** Page frame: one readable width, so a 1760px screen doesn't stretch every row edge to edge. */
const FRAME = "mx-auto w-full max-w-[1320px] px-5 pb-20 pt-8 sm:px-10 lg:pt-12";

function RangePicker({ value, onPick }: { value: number; onPick: (d: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Time range" className="flex shrink-0 gap-1 rounded-full bg-secondary/60 p-1 hairline">
      {RANGES.map((r) => (
        <button key={r.d} type="button" role="radio" aria-checked={value === r.d} onClick={() => onPick(r.d)} className={cn("relative h-11 rounded-full px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", value === r.d ? "text-[hsl(var(--lime-foreground))]" : "text-muted-foreground hover:text-foreground")}>
          {value === r.d && <motion.span layoutId="range" className="lime-bg absolute inset-0 rounded-full" />}
          <span className="relative">{r.label}</span>
        </button>
      ))}
    </div>
  );
}

/** renderedAt: when the server built this page; a copy prefetched from the nav (1039) can be a while old. */
export function AnalyticsView({ initial, connected, focusAccount = null, renderedAt }: { initial: AnalyticsSummary; connected: Partial<Record<Platform, boolean>>; focusAccount?: string | null; renderedAt?: number }) {
  const [data, setData] = useState(initial);
  const live = useLivePlatforms();
  const [loading, setLoading] = useState(false);
  const range = RANGES.find((r) => r.d === data.rangeDays) ?? RANGES[1];

  // 1037 drilldown: the combined list is remembered so picking one account never hides the others.
  const [drill, setDrill] = useState<string | null>(null);
  const [accounts, setAccounts] = useState(initial.byAccount);
  const url = (d: number, acct: string | null) => `/api/analytics?days=${d}${acct ? `&account=${encodeURIComponent(acct)}` : ""}`;
  const load = async (d: number, acct: string | null, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      // Ranges are warmed once the page is idle (below), so switching is usually instant.
      const next = await cachedApi<AnalyticsSummary>(url(d, acct), quiet ? 0 : 60_000);
      setData(next);
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
    // A copy prefetched from the nav may be a minute or two old: update it quietly (1039).
    else if (renderedAt && Date.now() - renderedAt > 30_000) void load(initial.rangeDays, null, true).catch(() => {});
    // The other ranges, so a switch doesn't wait on the server.
    return whenIdle(() => RANGES.forEach((r) => r.d !== initial.rangeDays && warmApi(url(r.d, null))), 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pick = (d: number) => (d === data.rangeDays ? undefined : load(d, drill));
  const pickAccount = (id: string | null) => (id === drill ? undefined : load(data.rangeDays, id));

  const anyConnected = Object.values(connected).some(Boolean);
  // Brand-new studio: nothing connected and nothing published. A review and live counter would only
  // shimmer at zero, so show the one thing that unlocks this page instead.
  if (!data.hasData && !anyConnected) {
    return (
      <div className={FRAME}>
        <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 text-center">
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
        <PlatformTabs connected={connected} />
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
  const shownP = landed.length ? landed : data.byPlatform;
  const quiet = landed.length ? data.byPlatform.filter((b) => b.views <= 0) : [];
  const maxP = Math.max(...shownP.map((b) => b.views), 1);
  const names = (xs: { platform: Platform }[]) => {
    const n = xs.map((x) => PLATFORM_META[x.platform].name);
    return n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n[0];
  };

  return (
    <div className={cn(FRAME, "transition-opacity", loading && "opacity-60")} aria-busy={loading}>
      <PlatformTabs connected={connected} />

      {/* The human headline comes first and is the page's h1. The range picker sits with it because it
          changes exactly these numbers. */}
      <header className="mt-10 flex flex-wrap items-end justify-between gap-6">
        <section aria-labelledby="insight" className="min-w-0 max-w-4xl">
          <p className="text-sm font-semibold text-muted-foreground">Published through Outlly</p>
          <h1 id="insight" className="display mt-2 text-[clamp(2.2rem,4.8vw,4.25rem)]">
            Your content reached <span className="energy-text"><CountUp value={data.totals.views} /></span> people {range.phrase}.
          </h1>
          <ul className="mt-4 flex flex-wrap gap-x-7 gap-y-2 text-base text-muted-foreground">
            {change !== null && (
              <li className="flex items-center gap-1.5">
                {change >= 0 ? <ArrowUpRight className="h-5 w-5 text-success" aria-hidden="true" /> : <ArrowDownRight className="h-5 w-5 text-warning" aria-hidden="true" />}
                {Math.abs(change) < 1 ? "About the same as before." : `${Math.round(Math.abs(change))}% ${change >= 0 ? "more" : "fewer"} than the ${range.d === 7 ? "week" : "period"} before.`}
              </li>
            )}
            {best && best.views > 0 && <li>{PLATFORM_META[best.platform].name} is where you&apos;re landing hardest.</li>}
            {data.bestDay && <li>{data.bestDay}s are your day.</li>}
          </ul>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          <ReportButtons days={data.rangeDays} account={drill} />
          <RangePicker value={data.rangeDays} onPick={pick} />
        </div>
      </header>

      <dl className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { k: "Views", v: data.totals.views },
          { k: "Likes", v: data.totals.likes },
          { k: "Comments", v: data.totals.comments },
          { k: "Shares", v: data.totals.shares },
          { k: "Engagement", v: data.totals.engagement, f: (n: number) => `${n.toFixed(1)}%` },
        ].map((m, i, all) => (
          <div key={m.k} className={cn("glass rounded-[22px] p-5", i === all.length - 1 && "col-span-2 sm:col-span-1")}>
            <dt className="text-sm text-muted-foreground">{m.k}</dt>
            <dd className="mt-1.5 text-[clamp(1.75rem,2.4vw,2.25rem)] font-semibold leading-none tracking-tight">
              <CountUp value={m.v} format={m.f} />
            </dd>
          </div>
        ))}
      </dl>

      <AccountDrill accounts={accounts} active={drill} onPick={pickAccount} busy={loading} />

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <section aria-labelledby="trend" className="glass flex flex-col rounded-[28px] p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="trend" className="text-lg font-semibold">Views over time</h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {live.map((p) => (
                <li key={p} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLATFORM_HALO[p] }} aria-hidden="true" /> {PLATFORM_META[p].name}
                </li>
              ))}
            </ul>
          </div>
          {/* Grows with the card next to it, so the chart never floats in an empty box. */}
          <div className="h-[300px] lg:h-auto lg:min-h-[300px] lg:flex-1" role="img" aria-label={`Daily views by platform over ${range.label}. Total ${compact(data.totals.views)}.`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                <defs>
                  {live.map((p) => (
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
                {live.map((p) => (
                  <Area isAnimationActive={false} key={p} type="monotone" dataKey={p} stackId="1" stroke={PLATFORM_HALO[p]} strokeWidth={2} fill={`url(#g-${p})`} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
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
                  <div className="mb-1.5 flex items-center gap-2.5 text-[15px]">
                    <PlatformOrb platform={b.platform} size={26} />
                    <span className="font-medium">{PLATFORM_META[b.platform].name}</span>
                    <span className="tabular ml-auto font-semibold">{compact(b.views)}<span className="sr-only"> views</span></span>
                    <span className="tabular w-14 text-right text-muted-foreground">{b.engagement.toFixed(1)}%<span className="sr-only"> engaged</span></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                    <motion.div className="h-full rounded-full" style={{ background: PLATFORM_HALO[b.platform] }} initial={{ width: 0 }} animate={{ width: `${(b.views / maxP) * 100}%` }} transition={{ delay: 0.2 + i * 0.1, duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
                  </div>
                </li>
              ))}
            </ul>
            {quiet.length > 0 && <p className="mt-5 border-t border-border/60 pt-4 text-sm text-muted-foreground">No views yet on {names(quiet)}.</p>}
            <p className="mt-3 text-sm text-muted-foreground">Engaged is likes, comments and shares per view.</p>
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

      <LiveStrip connected={connected} />
      <ProfileReview />
    </div>
  );
}
