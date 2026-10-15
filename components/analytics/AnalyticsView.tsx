"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D } from "@/components/brand/Icon3D";
import { PlatformOrb, PLATFORM_HALO } from "@/components/shared/PlatformIcon";
import { api } from "@/lib/client/api";
import { PLATFORM_META } from "@/lib/domain";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { cn, compact } from "@/lib/utils";
import type { AnalyticsSummary } from "@/lib/analytics";
import type { Platform } from "@/lib/domain";
import { PlatformTabs } from "./PlatformTabs";
import { LiveStrip } from "./LiveStrip";
import { ProfileReview } from "./ProfileReview";

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

export function AnalyticsView({ initial, connected }: { initial: AnalyticsSummary; connected: Partial<Record<Platform, boolean>> }) {
  const [data, setData] = useState(initial);
  const live = useLivePlatforms();
  const [loading, setLoading] = useState(false);
  const range = RANGES.find((r) => r.d === data.rangeDays) ?? RANGES[1];

  const pick = async (d: number) => {
    if (d === data.rangeDays) return;
    setLoading(true);
    try {
      setData(await api<AnalyticsSummary>(`/api/analytics?days=${d}`));
    } finally {
      setLoading(false);
    }
  };

  if (!data.hasData) {
    return (
      <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14">
        <PlatformTabs connected={connected} />
        <LiveStrip connected={connected} />
        <ProfileReview />
        <div className="flex min-h-[46dvh] flex-col items-center justify-center px-6 text-center">
          <Icon3D name="analytics" size={104} className="animate-bob mb-7" />
          <h1 className="display text-[clamp(2.2rem,5vw,3.2rem)]">Nothing published through Outlly yet.</h1>
          <p className="mt-3 max-w-md text-muted-foreground">
            {Object.values(connected).some(Boolean)
              ? "Your accounts' own numbers are live above. Once you publish from here, this page compares how each post did everywhere it went."
              : "Connect an account to see its live numbers above. Once you publish from here, this page compares how each post did everywhere it went."}
          </p>
          <Button asChild variant="lime" size="lg" className="mt-8">
            <Link href="/create">
              <Plus className="h-5 w-5" /> Make your first one
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const change = data.previous.views ? ((data.totals.views - data.previous.views) / data.previous.views) * 100 : null;
  const best = [...data.byPlatform].sort((a, b) => b.views - a.views)[0];
  const maxP = Math.max(...data.byPlatform.map((b) => b.views), 1);

  return (
    <div className={cn("px-5 pb-16 pt-8 transition-opacity sm:px-10 lg:pt-14", loading && "opacity-60")} aria-busy={loading}>
      <PlatformTabs connected={connected} />
      <LiveStrip connected={connected} />
        <ProfileReview />
      <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <p className="eyebrow">Published through Outlly</p>
        <div role="radiogroup" aria-label="Time range" className="flex gap-1 rounded-full bg-secondary/60 p-1 hairline">
          {RANGES.map((r) => (
            <button key={r.d} role="radio" aria-checked={data.rangeDays === r.d} onClick={() => pick(r.d)} className={cn("relative h-10 rounded-full px-4 text-sm font-medium", data.rangeDays === r.d ? "text-[hsl(var(--lime-foreground))]" : "text-muted-foreground hover:text-foreground")}>
              {data.rangeDays === r.d && <motion.span layoutId="range" className="lime-bg absolute inset-0 rounded-full" />}
              <span className="relative">{r.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* The human headline comes first. Numbers support it. */}
      <section aria-labelledby="insight" className="mt-8">
        <h1 id="insight" className="display max-w-5xl text-[clamp(2.4rem,6.4vw,5.6rem)]">
          Your content reached <span className="energy-text"><CountUp value={data.totals.views} /></span> people {range.phrase}.
        </h1>
        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-lg text-muted-foreground">
          {change !== null && (
            <p className="flex items-center gap-1.5">
              {change >= 0 ? <ArrowUpRight className="h-5 w-5 text-success" aria-hidden="true" /> : <ArrowDownRight className="h-5 w-5 text-warning" aria-hidden="true" />}
              {Math.abs(change) < 1 ? "About the same as before." : `${Math.round(Math.abs(change))}% ${change >= 0 ? "more" : "fewer"} than the ${range.d === 7 ? "week" : "period"} before.`}
            </p>
          )}
          {best && best.views > 0 && <p>{PLATFORM_META[best.platform].name} is where you&apos;re landing hardest.</p>}
          {data.bestDay && <p>{data.bestDay}s are your day.</p>}
        </div>
      </section>

      <dl className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { k: "Views", v: data.totals.views },
          { k: "Likes", v: data.totals.likes },
          { k: "Comments", v: data.totals.comments },
          { k: "Shares", v: data.totals.shares },
          { k: "Engagement", v: data.totals.engagement, f: (n: number) => `${n.toFixed(1)}%` },
        ].map((m) => (
          <div key={m.k} className="glass rounded-[24px] p-5">
            <dt className="text-sm text-muted-foreground">{m.k}</dt>
            <dd className="mt-1 text-3xl font-semibold tracking-tight">
              <CountUp value={m.v} format={m.f} />
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <section aria-labelledby="trend" className="glass rounded-[28px] p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="trend" className="text-lg font-semibold">Views over time</h2>
            <ul className="flex gap-4 text-xs text-muted-foreground">
              {live.map((p) => (
                <li key={p} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: PLATFORM_HALO[p] }} aria-hidden="true" /> {PLATFORM_META[p].name}
                </li>
              ))}
            </ul>
          </div>
          <div className="h-[280px]" role="img" aria-label={`Daily views by platform over ${range.label}. Total ${compact(data.totals.views)}.`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                <defs>
                  {live.map((p) => (
                    <linearGradient key={p} id={`g-${p}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PLATFORM_HALO[p]} stopOpacity={0.38} />
                      <stop offset="100%" stopColor={PLATFORM_HALO[p]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })} minTickGap={28} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickFormatter={(n: number) => compact(n)} width={48} />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--foreground) / 0.2)" }}
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 16, fontSize: 12, boxShadow: "var(--glass-shadow)", color: "hsl(var(--popover-foreground))" }}
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

        <div className="grid gap-3">
          <section aria-labelledby="where" className="glass rounded-[28px] p-6">
            <h2 id="where" className="mb-5 text-lg font-semibold">Where it landed</h2>
            <ul className="space-y-4">
              {data.byPlatform.map((b, i) => (
                <li key={b.platform}>
                  <div className="mb-1.5 flex items-center gap-2.5 text-sm">
                    <PlatformOrb platform={b.platform} size={24} />
                    <span className="font-medium">{PLATFORM_META[b.platform].name}</span>
                    <span className="tabular ml-auto">{compact(b.views)}</span>
                    <span className="tabular w-14 text-right text-muted-foreground">{b.engagement.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <motion.div className="h-full rounded-full" style={{ background: PLATFORM_HALO[b.platform] }} initial={{ width: 0 }} animate={{ width: `${(b.views / maxP) * 100}%` }} transition={{ delay: 0.2 + i * 0.1, duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">Views, then engagement rate (likes, comments and shares per view).</p>
          </section>

          {data.top && (
            <Link href="/content" className="group relative flex min-h-[170px] overflow-hidden rounded-[28px] p-6 hairline">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {data.top.thumbnailUrl && <img src={data.top.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40 transition duration-700 group-hover:scale-105 dark:opacity-50" />}
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
              <div className="relative mt-auto">
                <p className="eyebrow mb-2">Your standout</p>
                <p className="text-xl font-semibold leading-tight tracking-tight">{data.top.title}</p>
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <PlatformOrb platform={data.top.platform} size={20} /> {compact(data.top.views)} views on {PLATFORM_META[data.top.platform].name}
                </p>
              </div>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
