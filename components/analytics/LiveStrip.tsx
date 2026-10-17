"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleAlert, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHead } from "./SectionHead";
import { PlatformOrb, PLATFORM_HALO } from "@/components/shared/PlatformIcon";
import { api } from "@/lib/client/api";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { cn, compact } from "@/lib/utils";
import type { Headline, PlatformDashboard, Series } from "@/lib/live/types";

type Slot = PlatformDashboard | "error" | undefined;

const dur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s` : `${s.toFixed(s < 10 ? 1 : 0)}s`);
const fmt = (h: Headline) => {
  if (h.value === null) return "–";
  if (h.format === "duration") return dur(h.value);
  if (h.format === "pct") return `${h.value.toFixed(1)}%`;
  return compact(h.value);
};

/**
 * Small tiles fill the bento evenly next to the 2x2 featured tile (lg: 4 columns). The first four sit
 * beside it; any after that run in rows of four, and the last row stretches so no gap is left.
 * Literal class names so Tailwind keeps them.
 */
function smallSpans(m: number): string[] {
  const lg = (span: 1 | 2 | 4, tall = false) => cn(span === 4 ? "lg:col-span-4" : span === 2 ? "lg:col-span-2" : "lg:col-span-1", tall && "lg:row-span-2");
  const out: string[] = [];
  if (m === 1) out.push(lg(2, true));
  else if (m === 2) out.push(lg(2), lg(2));
  else if (m === 3) out.push(lg(2), lg(1), lg(1));
  else if (m >= 4) {
    for (let j = 0; j < 4; j++) out.push(lg(1));
    const r = m - 4, last = r % 4 || 4;
    for (let j = 0; j < r; j++) {
      const inLast = j >= r - last, k = j - (r - last);
      out.push(!inLast || last === 4 ? lg(1) : last === 1 ? lg(4) : last === 2 ? lg(2) : lg(k === 0 ? 2 : 1));
    }
  }
  /* sm: two columns; an odd one out takes the full row */
  return out.map((c, j) => cn(c, m % 2 === 1 && j === m - 1 && "sm:col-span-2"));
}

/** Bento of live numbers from the creator's own accounts. The first connected platform gets the big tile
 * (profile, headline with its change, more stats and a trend line); the rest are compact tiles. Each opens
 * that platform's dashboard. */
export function LiveStrip({ connected }: { connected: Partial<Record<Platform, boolean>> }) {
  const [data, setData] = useState<Partial<Record<Platform, Slot>>>({});
  const live = useLivePlatforms();
  useEffect(() => {
    for (const p of live)
      if (connected[p])
        api<PlatformDashboard>(`/api/platforms/${p}`)
          .then((d) => setData((x) => ({ ...x, [p]: d })))
          .catch(() => setData((x) => ({ ...x, [p]: "error" })));
  }, [connected, live]);

  /* Chosen from what is connected, never from what has loaded, so the big tile never jumps. */
  const order = useMemo(() => {
    const lead = live.find((p) => connected[p]) ?? live[0];
    return lead ? [lead, ...live.filter((p) => p !== lead)] : [];
  }, [live, connected]);
  if (!order.length) return null;
  /* Nothing connected yet: no featured tile to fill, so an even row of compact tiles instead. */
  const lead = !!connected[order[0]];
  const spans = lead ? smallSpans(order.length - 1) : [];
  const solo = order.length === 1;

  const desc = lead ? "Followers and views straight from each platform. Open one for its full dashboard." : undefined;
  return (
    <section aria-labelledby="live-strip" className="ai-type mt-16">
      <SectionHead id="live-strip" kicker="Live from your accounts" live={lead} title={lead ? "Your accounts right now" : "Connect your accounts"} desc={desc} />
      {lead ? (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {order.map((p, i) => (
            <li key={p} className={cn("min-w-0", i === 0 ? cn("sm:col-span-2", solo ? "lg:col-span-4" : "lg:row-span-2") : spans[i - 1])}>
              {i === 0 ? <Feature p={p} on d={data[p]} /> : <Small p={p} on={!!connected[p]} d={data[p]} />}
            </li>
          ))}
        </ul>
      ) : (
        <ConnectNudge platforms={order} />
      )}
    </section>
  );
}

/** Nothing connected: one clear ask instead of a row of identical empty tiles. */
function ConnectNudge({ platforms }: { platforms: Platform[] }) {
  const names = platforms.map((p) => PLATFORM_META[p].name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0];
  return (
    <div className="glass mt-5 flex flex-col gap-5 rounded-[24px] p-5 sm:flex-row sm:items-center sm:p-6">
      <span className="flex shrink-0 -space-x-2" aria-hidden="true">
        {platforms.map((p) => (
          <span key={p} className="rounded-full ring-2 ring-background">
            <PlatformOrb platform={p} size={40} />
          </span>
        ))}
      </span>
      <p className="min-w-0 flex-1 text-[15px] leading-relaxed text-muted-foreground">
        <span className="block font-semibold text-foreground">See live followers and views here.</span>
        Link {list} and their own numbers show up next to what you publish through Outlly.
      </p>
      <Button asChild variant="lime" size="lg" className="shrink-0">
        <Link href="/accounts">
          <Link2 className="h-5 w-5" aria-hidden="true" /> Connect accounts
        </Link>
      </Button>
    </div>
  );
}

const card = "glass group relative flex h-full flex-col overflow-hidden rounded-[24px] p-5 transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0";

function Top({ p, d, big }: { p: Platform; d: Slot; big?: boolean }) {
  const prof = d && d !== "error" && d.status === "ok" ? d.profile : undefined;
  return (
    <span className="relative flex min-w-0 items-center gap-2.5 text-[15px] font-medium">
      <PlatformOrb platform={p} size={big ? 34 : 26} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate">{PLATFORM_META[p].name}</span>
        {big && prof?.handle ? <span className="block truncate text-sm font-normal text-muted-foreground">{prof.handle.startsWith("@") ? prof.handle : `@${prof.handle}`}</span> : null}
      </span>
      <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </span>
  );
}

function Halo({ p, big }: { p: Platform; big?: boolean }) {
  return (
    <span
      className={cn("pointer-events-none absolute rounded-full blur-2xl transition-opacity", big ? "-right-16 -top-16 h-56 w-56 opacity-25 group-hover:opacity-40" : "-right-10 -top-10 h-32 w-32 opacity-20 group-hover:opacity-40")}
      style={{ background: PLATFORM_HALO[p] }}
      aria-hidden="true"
    />
  );
}

/** Not connected / loading / error / not ok: the same message in both tile sizes. */
function State({ on, d, big }: { on: boolean; d: Slot; big?: boolean }) {
  if (!on) return <span className="relative mt-auto text-sm text-muted-foreground">Not connected yet. Open to connect it.</span>;
  if (!d)
    return (
      <span className="relative mt-auto flex flex-col gap-4" aria-label="Loading">
        <span className={cn("animate-pulse rounded-lg bg-secondary", big ? "h-14 w-40" : "h-10 w-20")} />
        {big ? <span className="h-16 w-full animate-pulse rounded-lg bg-secondary" /> : null}
      </span>
    );
  /* A calm notice, not alarm-yellow text: the icon and words carry it, and the tile itself is the retry. */
  return (
    <span className="relative mt-auto flex items-start gap-2 text-sm text-muted-foreground">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{d === "error" ? "Couldn't load right now. Open it to try again." : d.message}</span>
    </span>
  );
}

function Delta({ v, days }: { v: number | null | undefined; days: number }) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const up = v >= 0, Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[13px] font-semibold tabular", up ? "bg-lime/25 text-lime-ink" : "bg-destructive/10 text-destructive")}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {up ? "+" : "−"}{Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}%
      <span className="sr-only"> vs the previous {days} days</span>
    </span>
  );
}

/** Decorative trend line; the numbers it shows are already on the tile as text. */
function Spark({ s }: { s?: Series }) {
  const pts = s?.points ?? [];
  if (pts.length < 2) return null;
  const vs = pts.map((x) => x.value), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const W = 320, H = 72;
  const xy = vs.map((v, j) => [(j / (vs.length - 1)) * W, H - 4 - ((v - lo) / span) * (H - 12)] as const);
  const line = xy.map(([x, y], j) => `${j ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="relative mt-5 h-[72px] w-full text-foreground" aria-hidden="true">
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="currentColor" opacity={0.07} />
      <path d={line} fill="none" stroke="currentColor" strokeOpacity={0.7} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Feature({ p, on, d }: { p: Platform; on: boolean; d: Slot }) {
  const ok = on && d && d !== "error" && d.status === "ok" ? d : null;
  const [lead, ...rest] = ok ? ok.headline : [];
  const trend = ok ? ok.series.find((s) => s.key === lead?.key) ?? ok.series[0] : undefined;
  return (
    <Link href={`/analytics/${p}`} className={cn(card, "min-h-[280px] p-6")}>
      <Halo p={p} big />
      <Top p={p} d={d} big />
      {!ok || !lead ? (
        <State on={on} d={d} big />
      ) : (
        <span className="relative mt-auto block pt-6">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[clamp(2.4rem,4.4vw,3.4rem)] font-semibold leading-none tracking-tight tabular">{fmt(lead)}</span>
            <Delta v={lead.delta} days={ok.rangeDays} />
          </span>
          <span className="mt-1.5 block text-sm text-muted-foreground">{lead.label}{lead.key === "views" ? `, last ${ok.rangeDays} days` : ""}</span>
          <Spark s={trend} />
          {rest.length ? (
            <span className="mt-5 grid grid-cols-3 gap-3 border-t border-border/60 pt-4">
              {rest.slice(0, 3).map((h) => (
                <span key={h.key} className="min-w-0">
                  <span className="block truncate text-lg font-semibold tracking-tight tabular">{fmt(h)}</span>
                  <span className="block truncate text-sm text-muted-foreground">{h.label}</span>
                </span>
              ))}
            </span>
          ) : null}
        </span>
      )}
    </Link>
  );
}

function Small({ p, on, d }: { p: Platform; on: boolean; d: Slot }) {
  const ok = on && d && d !== "error" && d.status === "ok" ? d : null;
  return (
    <Link href={`/analytics/${p}`} className={cn(card, "min-h-[132px]")}>
      <Halo p={p} />
      <Top p={p} d={d} />
      {!ok ? (
        <State on={on} d={d} />
      ) : (
        <span className="relative mt-auto flex flex-wrap gap-x-6 gap-y-2 pt-4">
          {ok.headline.slice(0, 2).map((h) => (
            <span key={h.key}>
              <span className="block text-2xl font-semibold tracking-tight tabular">{fmt(h)}</span>
              <span className="block text-sm text-muted-foreground">{h.label}{h.key === "views" ? `, ${ok.rangeDays} days` : ""}</span>
            </span>
          ))}
        </span>
      )}
    </Link>
  );
}
