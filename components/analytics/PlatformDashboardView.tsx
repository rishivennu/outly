"use client";
import { T, ease } from "@/lib/motion/tokens";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pollable } from "@/lib/client/idle";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, CircleAlert, ExternalLink, Info, KeyRound, Lightbulb, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D } from "@/components/brand/Icon3D";
import { PlatformOrb, PLATFORM_HALO } from "@/components/shared/PlatformIcon";
import { api, ApiError, cachedApi } from "@/lib/client/api";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn, compact } from "@/lib/utils";
import { freshness } from "@/lib/analytics/core";
import { DEFAULT_RANGE_DAYS, rangeNote, rangeOptions } from "@/lib/live/ranges";
import type { Headline, LivePost, PlatformDashboard, Suggestion } from "@/lib/live/types";
import { AnimatedNumber } from "@/components/shared/AnimatedNumber";
import { chartMotion, riseIndex, type NumberFormat } from "@/lib/motion/numbers";
import { ProfileAccounts, ProfileBreakdowns, type ProfileExtras } from "./ProfileExtras";

const POLL_MS = 60_000;
/** Numbers older than this are flagged as stale in the header instead of being called live. */
// Counts the platform keeps for the whole life of the account, so they are not limited to the reporting period.
const LIFETIME = new Set(["followers", "subscribers", "fans"]);
const STALE_MS = 15 * 60_000;

/** Under ten thousand in full (1,234), then short (12K); the count-up keeps the same unit (lib/motion/numbers.ts). */
const formatOfHeadline = (h: Headline): NumberFormat => (h.format === "duration" ? dur : h.format === "pct" ? "pct" : "count");
const dur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s` : `${s.toFixed(s < 10 ? 1 : 0)}s`);
const n = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v < 10_000 ? v.toLocaleString("en-US") : compact(v));

/** Card styling shared by every tile on the page, so the grid reads as one surface. */
const CARD = "glass rounded-[24px] p-5 sm:p-6";
const H2 = "text-base font-semibold sm:text-lg";

/**
 * 1172: what each headline number means, in the platform's own terms. Shown as a tooltip on the card. Only
 * keys the readers (lib/live/*.ts) actually emit are listed; a key with no entry simply has no tooltip.
 */
const METRIC_HELP: Record<string, string> = {
  followers: "People following this account right now. A lifetime count, not limited to the reporting period.",
  subscribers: "People subscribed to this channel right now. A lifetime count, not limited to the reporting period.",
  views: "Times your content was played or shown in the reporting period, as the platform counts it.",
  reach: "Unique accounts that saw any of your content in the reporting period.",
  engaged: "Unique accounts that liked, commented, saved or shared something of yours in the reporting period.",
  interactions: "Likes, comments, shares and saves added together for the reporting period.",
  profile: "Times your profile was opened in the reporting period.",
  watch: "Total hours people spent watching in the reporting period.",
  avd: "How long an average view lasted in the reporting period.",
  net: "Subscribers gained minus subscribers lost in the reporting period.",
  likes: "Likes on your recent posts, added together.",
  replies: "Replies on your recent posts, added together.",
  reposts: "Reposts and quotes of your recent posts, added together.",
  fans: "People who like this Page. A lifetime count.",
  comments: "Comments on your recent Reels, added together.",
  posts: "Everything this account has ever published. A lifetime count.",
  sent: "Posts published to this platform through Outlly.",
  recent: "Posts published through Outlly in the reporting period.",
};

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

/**
 * 1172 redesign. One account, one reporting window, one grid: the header names the profile and says how fresh
 * the numbers are; the range picker sets the window every card below shares; the KPI row, the charts, the
 * coaching, the audience and the posts sit in a 12-column grid that is two columns on a tablet and one on a
 * phone. Every number comes from the platform's own API through /api/analytics/profile; a value the platform
 * did not report says so instead of showing a zero, and a change is only drawn when the platform gave a
 * previous period to compare with.
 *
 * renderedAt: when the server built this page; a copy prefetched on hover (1039) can be a while old.
 */
export function PlatformDashboardView({ platform, initial, connected, renderedAt, focusAccount = null }: { platform: Platform; initial: PlatformDashboard; connected: Partial<Record<Platform, boolean>>; renderedAt?: number; focusAccount?: string | null }) {
  void connected; // the tab bar above (analytics/layout.tsx) shows what is connected
  const [data, setData] = useState(initial);
  // 1140: the accounts you manage on this platform, plus the format and timing breakdowns for the one shown.
  const [x, setX] = useState<ProfileExtras | null>(null);
  const [acct, setAcct] = useState<string | null>(focusAccount);
  const [days, setDays] = useState(initial.rangeDays);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const name = PLATFORM_META[platform].name;
  const live = data.status === "ok";
  // The latest picks, readable from the poll timer without restarting it.
  const current = useRef({ acct, days });
  current.current = { acct, days };
  // Review 1172: a reply that arrives after a newer request was sent is dropped, so a slow poll for account A
  // can never overwrite the screen once the creator has switched to B (or to another window).
  const seq = useRef(0);

  /**
   * The one loader. Every refresh (manual, poll, account switch, range switch) asks for the picked account's
   * own numbers in the picked window, so a poll can never swap in the default account's dashboard (the old
   * /api/platforms/{p} refresh did exactly that for a manager on their second account).
   */
  const loadProfile = useCallback(
    async (accountId: string | null, opts: { fresh?: boolean; days?: number } = {}) => {
      const mine = ++seq.current;
      setBusy(true);
      try {
        const q = new URLSearchParams({ platform });
        if (accountId) q.set("account", accountId);
        q.set("days", String(opts.days ?? current.current.days));
        if (opts.fresh) q.set("fresh", "1");
        const r = await api<ProfileExtras>(`/api/analytics/profile?${q.toString()}`);
        if (mine !== seq.current) return;
        setX(r);
        setAcct(r.accountId);
        setData(r);
        setDays(r.rangeDays);
        setErr(null);
      } catch (e) {
        if (mine !== seq.current) return;
        setErr(e instanceof ApiError ? e.message : "Couldn't load this profile just now.");
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    },
    [platform],
  );
  const load = useCallback((fresh: boolean) => loadProfile(current.current.acct, { fresh }), [loadProfile]);

  // The breakdowns load after the dashboard is on screen, so they never hold the numbers back. 1039: a copy
  // warmed earlier is shown at once; this same request also brings its numbers up to date.
  useEffect(() => {
    void loadProfile(focusAccount, { fresh: false, days: initial.rangeDays });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while the tab is visible; refresh straight away when the creator comes back to it.
  useEffect(() => {
    if (!live) return;
    let t: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(t);
      t = setInterval(() => pollable() && load(false), POLL_MS);
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
  void renderedAt; // the first loadProfile above refreshes a prefetched copy regardless of its age

  const options = rangeOptions(platform);
  const picked = x?.accounts.find((a) => a.accountId === acct) ?? null;
  const fetchedAge = now - new Date(data.fetchedAt).getTime();
  const stale = live && fetchedAge > STALE_MS;

  return (
    // The tab bar (and the top padding) live in analytics/layout.tsx since 1065, so a tab switch only moves this.
    <div className="page-frame pb-16" aria-busy={busy}>
      <header className="mt-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="relative shrink-0">
            {data.profile?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.profile.avatar} alt="" width={80} height={80} decoding="async" referrerPolicy="no-referrer" className="h-16 w-16 rounded-full object-cover hairline sm:h-20 sm:w-20" />
            ) : (
              <PlatformOrb platform={platform} size={64} />
            )}
            {data.profile?.avatar && <PlatformOrb platform={platform} size={26} ring className="absolute -bottom-1 -right-1" />}
          </div>
          <div className="min-w-0">
            <p className="eyebrow mb-1">{name} dashboard</p>
            <h1 className="display truncate pb-[0.08em] text-[clamp(1.9rem,4vw,3rem)] leading-[1.05]">{data.profile?.name ?? name}</h1>
            {data.profile && (
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="truncate">{data.profile.handle}</span>
                {data.profile.url && (
                  <a href={data.profile.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1 underline-offset-4 hover:text-foreground hover:underline">
                    Open on {name} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}
              </p>
            )}
          </div>
        </div>
        {live && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-live="polite">
              <div className="flex items-center gap-2">
                <dt className="sr-only">Connection</dt>
                <dd className="flex items-center gap-2">
                  {picked && picked.status !== "connected" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning-ink">
                      <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" /> Needs reconnect
                    </span>
                  ) : stale ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning-ink">Stale</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success-ink">
                      <span className="live-dot" aria-hidden="true" /> Live
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>Updated</dt>
                <dd className="text-foreground">{ago(data.fetchedAt, now)}</dd>
              </div>
              {x && (
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Outlly sync</dt>
                  <dd>{freshness(x.lastSyncAt, now).label}</dd>
                </div>
              )}
            </dl>
            <Button variant="outline" onClick={() => load(true)} disabled={busy} aria-label="Refresh now">
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden="true" /> Refresh
            </Button>
          </div>
        )}
      </header>

      {err && (
        <p role="alert" className="mt-4 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning-ink">
          {err} Showing the numbers from {ago(data.fetchedAt, now)}.
        </p>
      )}

      {x && x.accounts.length > 1 && <ProfileAccounts platform={platform} accounts={x.accounts} active={acct} onPick={(id) => void loadProfile(id)} busy={busy} />}

      {live && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div role="radiogroup" aria-label="Reporting period" className="gseg flex gap-1 rounded-full bg-secondary/60 p-1 hairline">
            {options.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={d === days} disabled={busy} onClick={() => d !== days && void loadProfile(acct, { days: d })} className={cn("relative h-11 rounded-full px-4 text-sm font-medium tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", d === days ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {d === days && <motion.span layoutId="live-range" className="gseg-pane absolute inset-0 rounded-full bg-background shadow-sm" transition={T.glide} />}
                <span className="relative">{d} days</span>
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Last {data.rangeDays} days, straight from {name}. Changes compare with the {data.rangeDays} days before.
            {rangeNote(platform) && <span className="sr-only"> {rangeNote(platform)}</span>}
          </p>
        </div>
      )}

      {!live ? <NotLive platform={platform} data={data} /> : <Live platform={platform} data={data} x={x} acct={acct} />}
    </div>
  );
}


function NotLive({ platform, data }: { platform: Platform; data: PlatformDashboard }) {
  const name = PLATFORM_META[platform].name;
  const icon = data.status === "needs_reconnect" ? "reconnect" : data.status === "error" ? "error" : data.status === "not_configured" ? "settings" : "connected";
  const title =
    data.status === "needs_reconnect" ? `Reconnect ${name}` : data.status === "error" ? `${name} didn't answer` : data.status === "not_configured" ? `${name} isn't set up on this server` : `Connect ${name} to go live`;
  return (
    <section className="glass mt-8 grid place-items-center rounded-[32px] px-6 py-14 text-center" aria-labelledby="nl">
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
          {/* 1172: a lost connection never leaves a dead end; Accounts lists every way to connect again. */}
          {!data.connect?.oauth && !data.connect?.token && (
            <Button asChild variant="lime" size="lg">
              <Link href="/accounts">
                {data.status === "needs_reconnect" ? `Reconnect in Accounts` : `Connect ${name} in Accounts`} <ArrowRight className="h-4 w-4" />
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

function Live({ platform, data, x, acct }: { platform: Platform; data: PlatformDashboard; x: ProfileExtras | null; acct: string | null }) {
  // Gemini ideas load after the numbers are on screen, so a slow model never holds the dashboard back.
  const [ideas, setIdeas] = useState<Suggestion[]>([]);
  const [thinking, setThinking] = useState(false);
  const enoughPosts = data.status === "ok" && data.posts.length >= 3;
  // Review 1172: ideas wait for the profile reply that names the account on screen, so the page asks once
  // (with ?account=) instead of once for the default account and again for the resolved one.
  const resolved = x !== null;
  useEffect(() => {
    if (!enoughPosts || !resolved) return;
    let gone = false;
    // Only say "thinking" if it takes a moment (no Gemini key answers instantly with nothing).
    const t = setTimeout(() => !gone && setThinking(true), 600);
    // Remembered for 5 minutes, so hopping between tabs doesn't ask the model again (1039). 1172: asked for
    // the account on screen, so a manager's second profile never gets ideas about the first.
    cachedApi<{ suggestions: Suggestion[] }>(`/api/platforms/${platform}/ideas${acct ? `?account=${encodeURIComponent(acct)}` : ""}`, 5 * 60_000)
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
  }, [platform, enoughPosts, resolved, acct]);
  const coach = useMemo(() => [...data.suggestions.filter((s) => s.source !== "ai"), ...ideas], [data.suggestions, ideas]);
  const color = PLATFORM_HALO[platform];
  const name = PLATFORM_META[platform].name;
  // Audience: the countries card is drawn when the platform gave them. Instagram is the one platform whose
  // permissions include follower locations, so only there does a missing breakdown get an honest empty card.
  const audience = data.breakdown ? "card" : platform === "instagram" ? "empty" : "none";
  const hasHours = !!data.hours?.length;
  return (
    <>
      {/* 1172: warnings about missing data come before the numbers they qualify, not after the posts list. */}
      <Notes notes={data.notes} />
      {/* The cards rise in themselves (.kpi-in), so the page entrance moves this row as one block. */}
      <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {data.headline.map((h, i) => (
          <Kpi key={h.key} h={h} i={i} platform={platform} days={data.rangeDays} />
        ))}
      </dl>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
        <Trend data={data} color={color} className="md:col-span-2 xl:col-span-8" />
        <Coach suggestions={coach} platform={platform} thinking={thinking} className="md:col-span-2 xl:col-span-4" />

        {hasHours && <Hours hours={data.hours!} color={color} className={cn(audience === "none" ? "md:col-span-2 xl:col-span-12" : "xl:col-span-7")} />}
        {audience === "card" && <Breakdown b={data.breakdown!} color={color} className={cn(hasHours ? "xl:col-span-5" : "md:col-span-2 xl:col-span-12")} />}
        {audience === "empty" && (
          <section aria-labelledby="bd" className={cn(CARD, "flex flex-col", hasHours ? "xl:col-span-5" : "md:col-span-2 xl:col-span-12")}>
            <h2 id="bd" className={H2}>Where your followers are</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {name} did not share follower locations for this account. It only does so for accounts with at least 100 followers, and the numbers come straight from {name}; nothing is estimated here.
            </p>
          </section>
        )}

        {x && <ProfileBreakdowns x={x} />}

        <Posts posts={data.posts} platform={platform} className="md:col-span-2 xl:col-span-12" />
      </div>
    </>
  );
}

/**
 * One summary metric. Big value, then the change against the previous window when the platform gave one;
 * a number the platform did not report says "Not reported" rather than showing a zero; a lifetime count
 * (followers) says so in its tooltip, since it is not limited to the reporting period.
 */
function Kpi({ h, i, platform, days }: { h: Headline; i: number; platform: Platform; days: number }) {
  const name = PLATFORM_META[platform].name;
  const help = METRIC_HELP[h.key];
  const hasDelta = typeof h.delta === "number" && Number.isFinite(h.delta);
  const lifetime = LIFETIME.has(h.key);
  const tipId = `kpi-tip-${platform}-${h.key}`;
  return (
    <div className="kpi-in glass flex min-h-[136px] flex-col rounded-[24px] p-4 sm:p-5" style={riseIndex(i)}>
      <dt className="flex items-start justify-between gap-2 text-sm font-medium text-muted-foreground">
        <span className="leading-snug">{h.label}</span>
        {help && (
          <span className="relative -mr-2 -mt-2 shrink-0">
            <button type="button" aria-label={`About ${h.label}`} aria-describedby={tipId} title={help} className="gbtn-icon ripple-host peer grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Info className="h-4 w-4" aria-hidden="true" />
            </button>
            <span id={tipId} role="tooltip" className="pointer-events-none absolute right-0 top-10 z-20 hidden w-56 rounded-xl bg-popover px-3 py-2 text-left text-xs font-normal leading-snug text-popover-foreground shadow-lg hairline peer-hover:block peer-focus-visible:block">
              {help}
            </span>
          </span>
        )}
      </dt>
      <dd className="mt-1 text-[1.75rem] font-semibold leading-none tracking-tight sm:text-[2rem]">
        <AnimatedNumber value={h.value} format={formatOfHeadline(h)} id={`live:${platform}:${h.key}`} />
      </dd>
      <dd className="mt-auto pt-3 text-xs leading-snug">
        {h.value === null ? (
          <p className="text-muted-foreground">Not reported by {name}</p>
        ) : hasDelta ? (
          <Delta value={h.delta as number} days={days} />
        ) : h.hint ? (
          <p className="text-muted-foreground">{h.hint}</p>
        ) : lifetime ? (
          <p className="text-muted-foreground">Lifetime total</p>
        ) : (
          <p className="text-muted-foreground">No comparison from {name}</p>
        )}
        {h.value !== null && hasDelta && h.hint && <p className="mt-1 line-clamp-2 text-muted-foreground">{h.hint}</p>}
        {h.value !== null && lifetime && h.hint && <p className="mt-1 text-muted-foreground">Lifetime total</p>}
      </dd>
    </div>
  );
}

function Delta({ value, days }: { value: number; days: number }) {
  const up = value >= 0;
  const flat = Math.abs(value) < 1;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className={cn("inline-flex items-center gap-0.5 font-semibold tabular", flat ? "text-muted-foreground" : up ? "text-success-ink" : "text-warning-ink")}>
        {!flat && (up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />)}
        <span className="sr-only">{flat ? "About the same as" : up ? "Up" : "Down"} </span>
        {flat ? "Flat" : `${Math.abs(value) >= 100 ? Math.round(Math.abs(value)) : Math.abs(value).toFixed(0)}%`}
      </span>
      <span className="text-muted-foreground">vs previous {days} days</span>
    </p>
  );
}

function Trend({ data, color, className }: { data: PlatformDashboard; color: string; className?: string }) {
  const [k, setK] = useState(data.series[0]?.key);
  const s = data.series.find((x) => x.key === k) ?? data.series[0];
  const total = s ? s.points.reduce((a, p) => a + p.value, 0) : 0;
  const perDay = s && s.points.length ? total / s.points.length : 0;
  const reduce = useReducedMotion();
  const first = s?.points[0]?.date;
  const last = s?.points[s.points.length - 1]?.date;
  const fmtDay = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <section aria-labelledby="trend" className={cn(CARD, "flex flex-col", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="trend" className={H2}>Reach and performance</h2>
          {s && first && last && (
            <p className="mt-1 text-sm text-muted-foreground">
              {s.label} per day, {fmtDay(first)} to {fmtDay(last)}
            </p>
          )}
        </div>
        {data.series.length > 1 && (
          <div role="radiogroup" aria-label="Metric" className="gseg flex gap-1 rounded-full bg-secondary/60 p-1">
            {data.series.map((x) => (
              <button key={x.key} role="radio" aria-checked={x.key === s?.key} onClick={() => setK(x.key)} className={cn("relative h-11 rounded-full px-3.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", x.key === s?.key ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {x.key === s?.key && <motion.span layoutId="series-pill" className="gseg-pane absolute inset-0 rounded-full bg-background shadow-sm" transition={T.glide} />}
                <span className="relative">{x.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {s && s.points.length ? (
        <>
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
            <div>
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="text-xl font-semibold tabular">{compact(total)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Average per day</dt>
              <dd className="text-xl font-semibold tabular">{compact(Math.round(perDay))}</dd>
            </div>
            <div className="ml-auto flex items-center gap-2 self-end text-xs text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" /> {s.label}
            </div>
          </dl>
          <div className="mt-4 h-[220px] sm:h-[280px]" role="img" aria-label={`${s.label} per day for ${s.points.length} days, ${compact(total)} in total.`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={s.points} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="g-live" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / 0.06)" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} tickFormatter={fmtDay} minTickGap={32} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} tickFormatter={(v: number) => compact(v)} width={48} allowDecimals={false} />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--foreground) / 0.2)" }}
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 16, fontSize: 13, color: "hsl(var(--popover-foreground))" }}
                  labelFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  formatter={(v: number) => [v.toLocaleString("en-US"), s.label]}
                />
                <Area {...chartMotion(reduce)} type="monotone" dataKey="value" stroke={color} strokeWidth={2.2} fill="url(#g-live)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <p className="mt-4 grid h-[160px] place-items-center text-center text-sm text-muted-foreground">No daily numbers from {PLATFORM_META[data.platform].name} for this period yet.</p>
      )}
    </section>
  );
}

const IMPACT = { high: "Top priority", medium: "Worth doing", low: "Small win" } as const;

function Coach({ suggestions, platform, thinking = false, className }: { suggestions: Suggestion[]; platform: Platform; thinking?: boolean; className?: string }) {
  const [open, setOpen] = useState<string | null>(suggestions[0]?.id ?? null);
  const ai = suggestions.some((s) => s.source === "ai");
  return (
    <section aria-labelledby="coach" className={cn(CARD, "relative flex flex-col overflow-hidden", className)}>
      <div className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full opacity-20 blur-3xl" style={{ background: PLATFORM_HALO[platform] }} aria-hidden="true" />
      <div className="relative flex items-center gap-2">
        <span className="lime-bg grid h-8 w-8 place-items-center rounded-full"><Sparkles className="h-4 w-4" aria-hidden="true" /></span>
        <h2 id="coach" className={H2}>What to do next</h2>
      </div>
      {suggestions.length === 0 ? (
        <p className="relative mt-4 text-sm leading-relaxed text-muted-foreground">Not enough posts yet to see a pattern. After a few more, suggestions show up here, each with the numbers behind it.</p>
      ) : (
        <ol className="relative mt-4 space-y-1.5">
          {suggestions.map((s, i) => {
            const isOpen = open === s.id;
            return (
              <li key={s.id} className={cn("rounded-2xl transition-colors", isOpen ? "bg-background/70 hairline" : "hover:bg-foreground/[0.03]")}>
                <button onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen} className="flex min-h-[48px] w-full items-center gap-3 px-3 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", s.impact === "high" ? "bg-lime" : s.impact === "medium" ? "bg-foreground/50" : "bg-foreground/25")} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium leading-snug">{s.title}</span>
                    {(i === 0 || isOpen) && <span className="mt-0.5 block text-xs text-muted-foreground">{IMPACT[s.impact]}</span>}
                  </span>
                  {s.source === "ai" && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI</span>}
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
                      <Link href={s.action.href} className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-lime-ink underline-offset-4 hover:underline">
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
      <p className="relative mt-auto pt-4 text-xs leading-snug text-muted-foreground">
        {ai ? `Worked out from your last ${DEFAULT_RANGE_DAYS} days of live numbers. Items tagged AI were written by Gemini from the same numbers.` : `Worked out from your last ${DEFAULT_RANGE_DAYS} days of live numbers. Nothing here is a guess: each one shows the figures behind it.`}
      </p>
    </section>
  );
}

function Hours({ hours, color, className }: { hours: NonNullable<PlatformDashboard["hours"]>; color: string; className?: string }) {
  const peak = hours.reduce((a, b) => (b.value > a.value ? b : a));
  const reduce = useReducedMotion();
  return (
    <section aria-labelledby="hours" className={cn(CARD, "flex flex-col", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="hours" className={H2}>When your followers are online</h2>
        <p className="text-sm text-muted-foreground">Peak at <strong className="text-foreground">{peak.label}</strong>, your time</p>
      </div>
      <div className="mt-4 h-[180px]" role="img" aria-label={`Followers online by hour. Peak ${peak.value} at ${peak.label}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={hours} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={3} padding={{ left: 8, right: 8 }} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <YAxis hide />
            <Tooltip cursor={{ fill: "hsl(var(--foreground) / 0.05)" }} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 14, fontSize: 13, color: "hsl(var(--popover-foreground))" }} formatter={(v: number) => [`${v} followers`, "Online"]} />
            <Bar {...chartMotion(reduce)} dataKey="value" radius={[6, 6, 2, 2]}>
              {hours.map((h) => (
                <Cell key={h.startMinute} fill={color} fillOpacity={h === peak ? 1 : 0.28 + 0.5 * (h.value / (peak.value || 1))} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">A lifetime pattern from the platform, not limited to the reporting period.</p>
    </section>
  );
}

function Breakdown({ b, color, className }: { b: NonNullable<PlatformDashboard["breakdown"]>; color: string; className?: string }) {
  const max = Math.max(...b.items.map((i) => i.value), 1);
  const sum = b.items.reduce((a, i) => a + i.value, 0);
  return (
    <section aria-labelledby="bd" className={cn(CARD, "flex flex-col", className)}>
      <h2 id="bd" className={H2}>{b.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Top {b.items.length} countries by followers</p>
      <ul className="mt-4 space-y-3">
        {b.items.map((i, k) => (
          <li key={i.label}>
            <div className="mb-1 flex items-center gap-2 text-sm">
              <span className="font-medium">{i.label}</span>
              <span className="tabular ml-auto text-muted-foreground">{sum ? `${((i.value / sum) * 100).toFixed(0)}%` : ""}</span>
              <span className="tabular w-16 text-right font-semibold">{n(i.value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${(i.value / max) * 100}%` }} transition={{ delay: 0.1 + k * 0.06, duration: 0.7, ease: "easeInOut" }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-auto pt-4 text-xs text-muted-foreground">Share of these {n(sum)} followers. A lifetime breakdown, not limited to the reporting period.</p>
    </section>
  );
}

const SORTS = [
  { k: "new", label: "Newest" },
  { k: "views", label: "Most viewed" },
  { k: "likes", label: "Most liked" },
  { k: "eng", label: "Most engaged" },
] as const;

function Posts({ posts, platform, className }: { posts: LivePost[]; platform: Platform; className?: string }) {
  const [sort, setSort] = useState<(typeof SORTS)[number]["k"]>("new");
  const [all, setAll] = useState(false);
  const reduce = useReducedMotion();
  const listRef = useRef<HTMLOListElement>(null);
  const sorted = useMemo(() => {
    const s = [...posts];
    if (sort === "views") s.sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
    else if (sort === "likes") s.sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1));
    else if (sort === "eng") s.sort((a, b) => (engagement(b) ?? -1) - (engagement(a) ?? -1));
    else s.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
    return s;
  }, [posts, sort]);
  const max = Math.max(...posts.map((p) => p.views ?? 0), 1);
  const shown = all ? sorted : sorted.slice(0, 8);
  const name = PLATFORM_META[platform].name;
  const unit = platform === "instagram" ? "Reels and posts" : platform === "youtube" ? "videos" : "posts";

  return (
    <section aria-labelledby="posts" className={cn(CARD, className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="posts" className={H2}>Recent {unit}</h2>
          <p className="mt-1 text-sm text-muted-foreground">The newest {posts.length} from {name}. Open one on {name} for its own analytics.</p>
        </div>
        <div role="radiogroup" aria-label="Sort posts" className="gseg -mx-1 flex max-w-full gap-1 overflow-x-auto rounded-full bg-secondary/60 p-1 scrollbar-none">
          {SORTS.map((s) => (
            <button key={s.k} role="radio" aria-checked={sort === s.k} onClick={() => setSort(s.k)} className={cn("relative h-11 shrink-0 whitespace-nowrap rounded-full px-3.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", sort === s.k ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {sort === s.k && <motion.span layoutId="sort-pill" className="gseg-pane absolute inset-0 rounded-full bg-background shadow-sm" transition={T.glide} />}
              <span className="relative">{s.label}</span>
            </button>
          ))}
        </div>
      </div>
      {posts.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nothing posted on {name} yet.</p>
      ) : (
        <>
          <div className="mt-4 hidden grid-cols-[64px_minmax(0,1.7fr)_repeat(4,minmax(0,0.55fr))_120px] gap-x-4 px-1.5 text-xs font-medium text-muted-foreground sm:grid" aria-hidden="true">
            <span />
            <span>Post</span>
            <span className="text-right">Views</span>
            <span className="text-right">Likes</span>
            <span className="text-right">{platform === "x" ? "Replies" : "Comments"}</span>
            <span className="text-right">Engagement</span>
            <span className="text-right">Platform</span>
          </div>
          <ol ref={listRef} className="mt-2 divide-y divide-border/60">
            {shown.map((p, i) => {
              const e = engagement(p);
              return (
                <motion.li key={p.id} layout={!reduce} transition={{ duration: 0.35, ease: ease("out") }} className="py-2.5 first:pt-0 last:pb-0">
                  <a href={p.url ?? undefined} target="_blank" rel="noopener noreferrer" className="group grid grid-cols-[56px_1fr] items-center gap-x-4 gap-y-2 rounded-2xl p-1.5 transition-colors hover:bg-foreground/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[64px_minmax(0,1.7fr)_repeat(4,minmax(0,0.55fr))_120px]">
                    <div className="relative row-span-2 aspect-[9/14] w-14 overflow-hidden rounded-xl bg-secondary sm:row-span-1 sm:w-16">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.thumb ? <img src={p.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <PlatformOrb platform={platform} size={28} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-60" />}
                      {sort !== "new" && <span className="absolute left-1 top-1 rounded-md bg-background/85 px-1.5 text-xs font-bold tabular">{i + 1}</span>}
                    </div>
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium leading-snug group-hover:underline group-hover:underline-offset-4">{p.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>{new Date(p.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                        <span className="rounded-full bg-secondary px-2 py-px">{p.format.replace(/s$/, "")}</span>
                        {p.avgWatch ? <span>{dur(p.avgWatch)} avg watch</span> : null}
                      </p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary sm:max-w-[220px]" aria-hidden="true">
                        <div className="h-full rounded-full" style={{ width: `${((p.views ?? 0) / max) * 100}%`, background: PLATFORM_HALO[platform] }} />
                      </div>
                    </div>
                    <dl className="col-start-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:contents">
                      <Stat k="Views" v={n(p.views)} />
                      <Stat k="Likes" v={n(p.likes)} />
                      <Stat k={platform === "x" ? "Replies" : "Comments"} v={n(p.comments)} />
                      <Stat k="Engagement" v={e === null ? "–" : `${e.toFixed(1)}%`} />
                    </dl>
                    <span className="hidden items-center justify-end gap-1.5 text-xs text-muted-foreground sm:flex">
                      <PlatformOrb platform={platform} size={18} /> {name} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </span>
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
          <p className="mt-3 text-xs text-muted-foreground">Engagement = likes, comments, shares and saves per view, where {name} reports them. A dash means {name} gave no number for that post.</p>
        </>
      )}
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-1 sm:block sm:text-right">
      <dt className="text-muted-foreground sm:sr-only">{k}</dt>
      <dd className="font-semibold tabular sm:text-sm">{v}</dd>
    </div>
  );
}

function Notes({ notes }: { notes: PlatformDashboard["notes"] }) {
  if (!notes.length) return null;
  return (
    <ul className="mt-4 space-y-2 text-left">
      {notes.map((x, i) => (
        <li key={i} className="rounded-2xl bg-warning/10 px-4 py-3 text-sm">
          <p className="flex items-start gap-2 text-foreground">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" aria-hidden="true" /> {x.text}
          </p>
          {x.detail && (
            <details className="mt-1 pl-6">
              <summary className="min-h-[28px] cursor-pointer text-xs text-muted-foreground">Technical detail</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">{x.detail}</pre>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
