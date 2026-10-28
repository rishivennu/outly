"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, CircleAlert, ExternalLink, KeyRound, Lightbulb, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D } from "@/components/brand/Icon3D";
import { PlatformOrb, PLATFORM_HALO } from "@/components/shared/PlatformIcon";
import { PlatformTabs } from "./PlatformTabs";
import { api, ApiError, cachedApi } from "@/lib/client/api";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn, compact } from "@/lib/utils";
import type { Headline, LivePost, PlatformDashboard, Suggestion } from "@/lib/live/types";

const POLL_MS = 60_000;

const fmtValue = (h: Headline) => {
  if (h.value === null) return "–";
  if (h.format === "duration") return dur(h.value);
  if (h.format === "pct") return `${h.value.toFixed(1)}%`;
  return h.value < 10_000 ? h.value.toLocaleString("en-US") : compact(h.value);
};
const dur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s` : `${s.toFixed(s < 10 ? 1 : 0)}s`);
const n = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v < 10_000 ? v.toLocaleString("en-US") : compact(v));

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

function engagement(p: LivePost) {
  if (!p.views) return null;
  return (((p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)) / p.views) * 100;
}

/** renderedAt: when the server built this page; a copy prefetched on hover (1039) can be a while old. */
export function PlatformDashboardView({ platform, initial, connected, renderedAt }: { platform: Platform; initial: PlatformDashboard; connected: Partial<Record<Platform, boolean>>; renderedAt?: number }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const name = PLATFORM_META[platform].name;
  const live = data.status === "ok";

  const load = useCallback(
    async (fresh: boolean) => {
      setBusy(true);
      try {
        setData(await api<PlatformDashboard>(`/api/platforms/${platform}${fresh ? "?fresh=1" : ""}`));
        setErr(null);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Couldn't refresh just now.");
      } finally {
        setBusy(false);
      }
    },
    [platform],
  );

  // Poll while the tab is visible; refresh straight away when the creator comes back to it.
  useEffect(() => {
    if (!live) return;
    let t: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(t);
      t = setInterval(() => load(false), POLL_MS);
    };
    const onVis = () => {
      if (document.hidden) clearInterval(t);
      else {
        if (Date.now() - new Date(data.fetchedAt).getTime() > POLL_MS) load(false);
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [live, load, data.fetchedAt]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  // Opened from a page warmed earlier: show it at once, then bring the numbers up to date.
  useEffect(() => {
    if (live && renderedAt && Date.now() - renderedAt > 30_000) void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14" aria-busy={busy}>
      <PlatformTabs connected={connected} />

      <header className="mt-8 flex flex-wrap items-end justify-between gap-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="relative shrink-0">
            {data.profile?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.profile.avatar} alt="" referrerPolicy="no-referrer" className="h-16 w-16 rounded-full object-cover hairline" />
            ) : (
              <PlatformOrb platform={platform} size={64} />
            )}
            {data.profile?.avatar && <PlatformOrb platform={platform} size={26} ring className="absolute -bottom-1 -right-1" />}
          </div>
          <div className="min-w-0">
            <p className="eyebrow mb-1">{name} dashboard</p>
            <h1 className="display truncate text-[clamp(2rem,4.6vw,3.4rem)] leading-none">{data.profile?.name ?? name}</h1>
            {data.profile && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                <span>{data.profile.handle}</span>
                {data.profile.url && (
                  <a href={data.profile.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[28px] items-center gap-1 underline-offset-4 hover:text-foreground hover:underline">
                    Open on {name} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}
              </p>
            )}
          </div>
        </div>
        {live && (
          <div className="flex items-center gap-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              <span className="live-dot" aria-hidden="true" />
              Live · updated {ago(data.fetchedAt, now)}
            </p>
            <Button variant="ghost" onClick={() => load(true)} disabled={busy} aria-label="Refresh now">
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden="true" /> Refresh
            </Button>
          </div>
        )}
      </header>

      {err && (
        <p role="alert" className="mt-4 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">
          {err} Showing the numbers from {ago(data.fetchedAt, now)}.
        </p>
      )}

      {!live ? <NotLive platform={platform} data={data} /> : <Live platform={platform} data={data} />}
    </div>
  );
}

function NotLive({ platform, data }: { platform: Platform; data: PlatformDashboard }) {
  const name = PLATFORM_META[platform].name;
  const icon = data.status === "needs_reconnect" ? "reconnect" : data.status === "error" ? "error" : data.status === "not_configured" ? "settings" : "connected";
  const title =
    data.status === "needs_reconnect" ? `Reconnect ${name}` : data.status === "error" ? `${name} didn't answer` : data.status === "not_configured" ? `${name} isn't set up on this server` : `Connect ${name} to go live`;
  return (
    <section className="glass mt-10 grid place-items-center rounded-[32px] px-6 py-16 text-center" aria-labelledby="nl">
      <Icon3D name={icon} size={104} className="animate-bob mb-6" />
      <h2 id="nl" className="display text-[clamp(2rem,4vw,3rem)]">{title}</h2>
      <p className="mt-3 max-w-md text-muted-foreground">{data.message}</p>
      {data.status !== "not_configured" && data.status !== "error" && (
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {data.connect?.oauth && (
            <Button asChild variant="lime" size="lg">
              <a href={`/api/accounts/${platform}/connect?returnTo=/analytics/${platform}`}>
                {data.status === "needs_reconnect" ? "Reconnect" : `Connect ${name}`} <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
          )}
          {data.connect?.token && (
            <Button asChild variant={data.connect.oauth ? "ghost" : "lime"} size="lg">
              <Link href="/accounts#instagram">
                <KeyRound className="h-4 w-4" /> Connect with a token
              </Link>
            </Button>
          )}
        </div>
      )}
      {data.status === "not_connected" && (
        <ul className="mt-10 grid max-w-2xl gap-3 text-left text-sm text-muted-foreground sm:grid-cols-3">
          {["Live followers, reach and views", "Every recent post, ranked", "Suggestions worked out from your numbers"].map((t) => (
            <li key={t} className="rounded-2xl bg-secondary/50 px-4 py-3 hairline">{t}</li>
          ))}
        </ul>
      )}
      <Notes notes={data.notes} />
    </section>
  );
}

function Live({ platform, data }: { platform: Platform; data: PlatformDashboard }) {
  // Gemini ideas load after the numbers are on screen, so a slow model never holds the dashboard back.
  const [ideas, setIdeas] = useState<Suggestion[]>([]);
  const [thinking, setThinking] = useState(false);
  const enoughPosts = data.status === "ok" && data.posts.length >= 3;
  useEffect(() => {
    if (!enoughPosts) return;
    let gone = false;
    // Only say "thinking" if it takes a moment (no Gemini key answers instantly with nothing).
    const t = setTimeout(() => !gone && setThinking(true), 600);
    // Remembered for 5 minutes, so hopping between tabs doesn't ask the model again (1039).
    cachedApi<{ suggestions: Suggestion[] }>(`/api/platforms/${platform}/ideas`, 5 * 60_000)
      .then((r) => !gone && setIdeas(r.suggestions ?? []))
      .catch(() => {})
      .finally(() => {
        clearTimeout(t);
        if (!gone) setThinking(false);
      });
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [platform, enoughPosts]);
  const coach = useMemo(() => [...data.suggestions.filter((s) => s.source !== "ai"), ...ideas], [data.suggestions, ideas]);
  const color = PLATFORM_HALO[platform];
  return (
    <>
      <dl className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-stagger>
        {data.headline.map((h, i) => (
          <motion.div key={h.key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="glass flex flex-col rounded-[24px] p-5">
            <dt className="text-sm text-muted-foreground">{h.label}</dt>
            <dd className="mt-1 text-[1.9rem] font-semibold leading-tight tracking-tight tabular">{fmtValue(h)}</dd>
            {h.delta !== undefined && h.delta !== null && <Delta value={h.delta} days={data.rangeDays} />}
            {h.hint && <p className="mt-1 text-xs leading-snug text-muted-foreground">{h.hint}</p>}
          </motion.div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">Last {data.rangeDays} days, straight from {PLATFORM_META[platform].name}. Arrows compare with the {data.rangeDays} days before.</p>

      <div className="mt-6 grid gap-3 lg:grid-cols-[1.55fr_1fr]">
        <Trend data={data} color={color} />
        <Coach suggestions={coach} platform={platform} thinking={thinking} />
      </div>

      {(data.hours?.length || data.breakdown) && (
        <div className="mt-3 grid gap-3 lg:grid-cols-[1.55fr_1fr]">
          {data.hours?.length ? <Hours hours={data.hours} color={color} /> : <div className="hidden lg:block" />}
          {data.breakdown && <Breakdown b={data.breakdown} color={color} />}
        </div>
      )}

      <Posts posts={data.posts} platform={platform} />
      <Notes notes={data.notes} />
    </>
  );
}

function Delta({ value, days }: { value: number; days: number }) {
  const up = value >= 0;
  const flat = Math.abs(value) < 1;
  return (
    <p className={cn("mt-1 inline-flex items-center gap-1 text-xs font-medium", flat ? "text-muted-foreground" : up ? "text-success" : "text-warning")}>
      {!flat && (up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />)}
      <span className="sr-only">{flat ? "About the same as" : up ? "Up" : "Down"} </span>
      {flat ? "Flat" : `${Math.abs(value) >= 100 ? Math.round(Math.abs(value)) : Math.abs(value).toFixed(0)}%`}
      <span className="sr-only"> versus the previous {days} days</span>
    </p>
  );
}

function Trend({ data, color }: { data: PlatformDashboard; color: string }) {
  const [k, setK] = useState(data.series[0]?.key);
  const s = data.series.find((x) => x.key === k) ?? data.series[0];
  const total = s ? s.points.reduce((a, p) => a + p.value, 0) : 0;
  return (
    <section aria-labelledby="trend" className="glass rounded-[28px] p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="trend" className="text-lg font-semibold">{s ? `${s.label} per day` : "Daily trend"}</h2>
        {data.series.length > 1 && (
          <div role="radiogroup" aria-label="Metric" className="flex gap-1 rounded-full bg-secondary/60 p-1">
            {data.series.map((x) => (
              <button key={x.key} role="radio" aria-checked={x.key === s?.key} onClick={() => setK(x.key)} className={cn("relative h-9 rounded-full px-3 text-xs font-medium", x.key === s?.key ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {x.key === s?.key && <motion.span layoutId="series-pill" className="absolute inset-0 rounded-full bg-background shadow-sm" />}
                <span className="relative">{x.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {s && s.points.length ? (
        <div className="h-[260px]" role="img" aria-label={`${s.label} per day for ${s.points.length} days, ${compact(total)} in total.`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={s.points} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="g-live" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })} minTickGap={28} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickFormatter={(v: number) => compact(v)} width={44} allowDecimals={false} />
              <Tooltip
                cursor={{ stroke: "hsl(var(--foreground) / 0.2)" }}
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 16, fontSize: 12, color: "hsl(var(--popover-foreground))" }}
                labelFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                formatter={(v: number) => [v.toLocaleString("en-US"), s.label]}
              />
              <Area isAnimationActive={false} type="monotone" dataKey="value" stroke={color} strokeWidth={2.2} fill="url(#g-live)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="grid h-[260px] place-items-center text-center text-sm text-muted-foreground">No daily numbers from this platform yet.</p>
      )}
    </section>
  );
}

function Coach({ suggestions, platform, thinking = false }: { suggestions: Suggestion[]; platform: Platform; thinking?: boolean }) {
  const [open, setOpen] = useState<string | null>(suggestions[0]?.id ?? null);
  const ai = suggestions.some((s) => s.source === "ai");
  return (
    <section aria-labelledby="coach" className="glass relative overflow-hidden rounded-[28px] p-5 sm:p-6">
      <div className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full opacity-25 blur-3xl" style={{ background: PLATFORM_HALO[platform] }} aria-hidden="true" />
      <div className="relative mb-4 flex items-center gap-2">
        <span className="lime-bg grid h-8 w-8 place-items-center rounded-full"><Sparkles className="h-4 w-4" aria-hidden="true" /></span>
        <h2 id="coach" className="text-lg font-semibold">What to do next</h2>
      </div>
      {suggestions.length === 0 ? (
        <p className="relative text-sm text-muted-foreground">Not enough posts yet to see a pattern. After a few more, suggestions show up here, each with the numbers behind it.</p>
      ) : (
        <ol className="relative space-y-2">
          {suggestions.map((s) => {
            const isOpen = open === s.id;
            return (
              <li key={s.id} className={cn("rounded-2xl transition-colors", isOpen ? "bg-background/70 hairline" : "hover:bg-foreground/[0.03]")}>
                <button onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen} className="flex min-h-[48px] w-full items-center gap-3 px-3 py-2.5 text-left">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", s.impact === "high" ? "bg-lime" : s.impact === "medium" ? "bg-foreground/50" : "bg-foreground/25")} aria-hidden="true" />
                  <span className="flex-1 text-[15px] font-medium leading-snug">{s.title}</span>
                  {s.source === "ai" && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">AI</span>}
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 pl-8">
                    <p className="text-sm leading-relaxed">{s.body}</p>
                    {s.evidence && (
                      <p className="mt-2 flex gap-1.5 text-xs leading-relaxed text-muted-foreground">
                        <Lightbulb className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {s.evidence}
                      </p>
                    )}
                    {s.action && (
                      <Link href={s.action.href} className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 text-sm font-semibold text-lime-ink underline-offset-4 hover:underline">
                        {s.action.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {thinking && (
        <p role="status" className="relative mt-3 flex items-center gap-2 px-3 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" /> Gemini is reading your numbers for more ideas…
        </p>
      )}
      <p className="relative mt-4 text-[11px] leading-snug text-muted-foreground">
        {ai ? "Worked out from your live numbers. Items tagged AI were written by Gemini from the same numbers." : "Worked out from your live numbers. Nothing here is a guess: each one shows the figures behind it."}
      </p>
    </section>
  );
}

function Hours({ hours, color }: { hours: NonNullable<PlatformDashboard["hours"]>; color: string }) {
  const peak = hours.reduce((a, b) => (b.value > a.value ? b : a));
  return (
    <section aria-labelledby="hours" className="glass rounded-[28px] p-5 sm:p-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="hours" className="text-lg font-semibold">When your followers are online</h2>
        <p className="text-sm text-muted-foreground">Peak at <strong className="text-foreground">{peak.label}</strong>, your time</p>
      </div>
      <div className="h-[170px]" role="img" aria-label={`Followers online by hour. Peak ${peak.value} at ${peak.label}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={hours} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={3} padding={{ left: 8, right: 8 }} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
            <YAxis hide />
            <Tooltip cursor={{ fill: "hsl(var(--foreground) / 0.05)" }} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 14, fontSize: 12, color: "hsl(var(--popover-foreground))" }} formatter={(v: number) => [`${v} followers`, "Online"]} />
            <Bar isAnimationActive={false} dataKey="value" radius={[6, 6, 2, 2]}>
              {hours.map((h) => (
                <Cell key={h.startMinute} fill={color} fillOpacity={h === peak ? 1 : 0.28 + 0.5 * (h.value / (peak.value || 1))} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function Breakdown({ b, color }: { b: NonNullable<PlatformDashboard["breakdown"]>; color: string }) {
  const max = Math.max(...b.items.map((i) => i.value), 1);
  const sum = b.items.reduce((a, i) => a + i.value, 0);
  return (
    <section aria-labelledby="bd" className="glass rounded-[28px] p-5 sm:p-6">
      <h2 id="bd" className="mb-4 text-lg font-semibold">{b.title}</h2>
      <ul className="space-y-3">
        {b.items.map((i, k) => (
          <li key={i.label}>
            <div className="mb-1 flex items-center text-sm">
              <span className="font-medium">{i.label}</span>
              <span className="tabular ml-auto text-muted-foreground">{i.value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${(i.value / max) * 100}%` }} transition={{ delay: 0.1 + k * 0.06, duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">Top {b.items.length} countries, {sum} followers between them.</p>
    </section>
  );
}

const SORTS = [
  { k: "new", label: "Newest" },
  { k: "views", label: "Most views" },
  { k: "eng", label: "Best engagement" },
] as const;

function Posts({ posts, platform }: { posts: LivePost[]; platform: Platform }) {
  const [sort, setSort] = useState<(typeof SORTS)[number]["k"]>("new");
  const [all, setAll] = useState(false);
  const reduce = useReducedMotion();
  const listRef = useRef<HTMLOListElement>(null);
  const sorted = useMemo(() => {
    const s = [...posts];
    if (sort === "views") s.sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
    else if (sort === "eng") s.sort((a, b) => (engagement(b) ?? -1) - (engagement(a) ?? -1));
    else s.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
    return s;
  }, [posts, sort]);
  const max = Math.max(...posts.map((p) => p.views ?? 0), 1);
  const shown = all ? sorted : sorted.slice(0, 8);
  const unit = platform === "instagram" ? "Reels and posts" : platform === "youtube" ? "videos" : "posts";

  return (
    <section aria-labelledby="posts" className="glass mt-3 rounded-[28px] p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="posts" className="text-lg font-semibold">Recent {unit}</h2>
        <div role="radiogroup" aria-label="Sort posts" className="flex gap-1 rounded-full bg-secondary/60 p-1">
          {SORTS.map((s) => (
            <button key={s.k} role="radio" aria-checked={sort === s.k} onClick={() => setSort(s.k)} className={cn("relative h-9 rounded-full px-3 text-xs font-medium", sort === s.k ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {sort === s.k && <motion.span layoutId="sort-pill" className="absolute inset-0 rounded-full bg-background shadow-sm" />}
              <span className="relative">{s.label}</span>
            </button>
          ))}
        </div>
      </div>
      {posts.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nothing posted on {PLATFORM_META[platform].name} yet.</p>
      ) : (
        <>
          <ol ref={listRef} className="divide-y divide-border/60">
            {shown.map((p, i) => {
              const e = engagement(p);
              return (
                <motion.li key={p.id} layout={!reduce} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="py-3 first:pt-0 last:pb-0">
                  <a href={p.url ?? undefined} target="_blank" rel="noopener noreferrer" className="group grid grid-cols-[56px_1fr] items-center gap-x-4 gap-y-2 rounded-2xl p-1.5 transition-colors hover:bg-foreground/[0.03] sm:grid-cols-[64px_minmax(0,1.6fr)_repeat(4,minmax(0,0.6fr))]">
                    <div className="relative row-span-2 aspect-[9/14] w-14 overflow-hidden rounded-xl bg-secondary sm:row-span-1 sm:w-16">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.thumb && <img src={p.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />}
                      {sort !== "new" && <span className="absolute left-1 top-1 rounded-md bg-background/85 px-1.5 text-[10px] font-bold tabular">{i + 1}</span>}
                    </div>
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium leading-snug group-hover:underline group-hover:underline-offset-4">{p.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{new Date(p.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                        <span className="rounded-full bg-secondary px-2 py-px">{p.format.replace(/s$/, "")}</span>
                        {p.avgWatch ? <span>{dur(p.avgWatch)} avg watch</span> : null}
                      </p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary sm:max-w-[220px]" aria-hidden="true">
                        <div className="h-full rounded-full" style={{ width: `${((p.views ?? 0) / max) * 100}%`, background: PLATFORM_HALO[platform] }} />
                      </div>
                    </div>
                    <dl className="col-start-2 flex flex-wrap gap-x-4 gap-y-1 text-xs sm:contents">
                      <Stat k="Views" v={n(p.views)} />
                      <Stat k="Likes" v={n(p.likes)} />
                      <Stat k={platform === "x" ? "Replies" : "Comments"} v={n(p.comments)} />
                      <Stat k="Engagement" v={e === null ? "–" : `${e.toFixed(1)}%`} />
                    </dl>
                  </a>
                </motion.li>
              );
            })}
          </ol>
          {sorted.length > 8 && (
            <div className="mt-4 text-center">
              <Button variant="ghost" onClick={() => setAll((a) => !a)} aria-expanded={all}>
                {all ? "Show fewer" : `Show all ${sorted.length}`}
              </Button>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Engagement = likes, comments, shares and saves per view, where {PLATFORM_META[platform].name} reports them.</p>
        </>
      )}
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-1 sm:block sm:text-right">
      <dt className="text-muted-foreground sm:text-[11px]">{k}</dt>
      <dd className="font-semibold tabular sm:text-sm">{v}</dd>
    </div>
  );
}

function Notes({ notes }: { notes: PlatformDashboard["notes"] }) {
  if (!notes.length) return null;
  return (
    <ul className="mt-6 space-y-2 text-left">
      {notes.map((x, i) => (
        <li key={i} className="rounded-2xl bg-warning/10 px-4 py-3 text-sm">
          <p className="flex items-start gap-2 text-foreground">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" /> {x.text}
          </p>
          {x.detail && (
            <details className="mt-1 pl-6">
              <summary className="min-h-[28px] cursor-pointer text-xs text-muted-foreground">Technical detail</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted-foreground">{x.detail}</pre>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
