"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { pollable } from "@/lib/client/idle";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, CircleAlert, Clock, LayoutGrid, RefreshCw, Sparkles, TriangleAlert, Users } from "lucide-react";
import { Pip } from "@/components/brand/Pip";
import { PlatformOrb, PLATFORM_HALO } from "@/components/shared/PlatformIcon";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError, swrApi } from "@/lib/client/api";
import { PLATFORM_META } from "@/lib/domain";
import { cn, compact } from "@/lib/utils";
import type { ProfileReview as Review, ReviewStat } from "@/lib/live/review-core";
import type { LiveTotals } from "@/lib/live/review";
import { AnimatedNumber } from "@/components/shared/AnimatedNumber";
import { cssTiming } from "@/lib/motion/numbers";

type Loaded = { review: Review; ai: boolean; stale: boolean; nextRegenAt?: string | null };
const POLL_MS = 30_000;
const EASE = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/* Small animated pieces                                                */
/* ------------------------------------------------------------------ */

/** Rolling digits for the live counter. Each digit is a 0-9 strip that slides to its place. */
function Odometer({ value, label }: { value: number; label: string }) {
  const reduce = useReducedMotion();
  const text = Math.round(value).toLocaleString("en-US");
  return (
    <span className="relative inline-flex tabular leading-none">
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="inline-flex">
        {text.split("").map((ch, i) =>
          /\d/.test(ch) ? (
            <span key={`${text.length - i}`} className="relative inline-block h-[1em] w-[0.62em] overflow-hidden">
              <span
                className="absolute left-0 top-0 flex w-full flex-col items-center"
                style={{ transform: `translateY(-${Number(ch) * 10}%)`, transition: reduce ? "none" : `transform ${cssTiming("secondary")}` }}
              >
                {Array.from({ length: 10 }, (_, d) => (
                  <span key={d} className="block h-[1em] leading-none">{d}</span>
                ))}
              </span>
            </span>
          ) : (
            <span key={`${text.length - i}`} className="inline-block w-[0.3em] text-center">{ch}</span>
          ),
        )}
      </span>
    </span>
  );
}

function Delta({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const flat = Math.abs(value) < 0.5;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[13px] font-semibold", flat ? "bg-secondary text-muted-foreground" : up ? "bg-success/15 pr-good" : "bg-warning/15 text-warning-ink")}>
      {!flat && (up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />)}
      <span className="sr-only">{flat ? "About the same as before" : up ? "Up" : "Down"}</span>
      {flat ? "Flat" : `${Math.abs(value) < 10 ? Math.abs(value).toFixed(1) : Math.round(Math.abs(value))}${suffix}`}
    </span>
  );
}

/** One solid brand colour (lime on dark, its deep ink on light). The number in the middle says the score;
 * the ring only shows how full it is. */
function ScoreRing({ score, size = 156 }: { score: number | null; size?: number }) {
  const reduce = useReducedMotion();
  const r = size / 2 - 11;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : score / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--foreground) / 0.08)" strokeWidth={11} />
        <motion.circle
          className="pr-ring"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={11}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? c * (1 - pct) : c }}
          whileInView={{ strokeDashoffset: c * (1 - pct) }}
          viewport={{ once: true }}
          transition={{ duration: reduce ? 0 : 1.4, ease: EASE }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {score === null ? <span className="text-2xl font-semibold text-muted-foreground">--</span> : <AnimatedNumber value={score} format="int" tier="main" id="review:score" className="text-5xl font-semibold tracking-tight" />}
        <span className="mt-1 text-sm text-muted-foreground">out of 100</span>
      </div>
    </div>
  );
}

const fmtStat = (s: ReviewStat) => (n: number) => (s.format === "pct" ? `${n.toFixed(1)}%` : s.format === "rate" ? n.toFixed(1) : compact(n));

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function Tile({ className, children, label, delay = 0 }: { className?: string; children: React.ReactNode; label?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      aria-label={label}
      // Same start on the server and the client: `initial={false}` only on the client left reduced-motion users with
      // the server's hidden tile, never patched (1102). MotionRoot drops the rise for them; it just fades.
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: reduce ? 0.2 : 0.5, ease: EASE, delay: reduce ? 0 : delay }}
      className={cn("glass relative min-w-0 overflow-hidden rounded-[28px] p-5 sm:p-6", className)}
    >
      {children}
    </motion.section>
  );
}

function Shimmer({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="pr-shimmer h-3.5 rounded-full" style={{ width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live views                                                           */
/* ------------------------------------------------------------------ */

function LiveViews({ delay, className }: { delay: number; className?: string }) {
  const [data, setData] = useState<LiveTotals | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const first = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shown = useRef(false);

  const load = useCallback(async () => {
    const show = (d: LiveTotals) => {
      setData(d);
      setFailed(false);
      if (first.current === null && d.views !== null) first.current = d.views;
    };
    try {
      // First paint may use the copy the nav warmed (1039); every poll after that asks the server.
      if (first.current === null && !shown.current) {
        shown.current = true;
        await swrApi<LiveTotals>("/api/analytics/live", show, { fresh: 20_000, keep: 2 * 60_000 });
      } else show(await api<LiveTotals>("/api/analytics/live"));
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const loop = async () => {
      if (pollable()) await load();
      if (alive) timer.current = setTimeout(loop, POLL_MS);
    };
    loop();
    const onVis = () => {
      if (!document.hidden) {
        clearTimeout(timer.current);
        loop();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      alive = false;
      clearTimeout(timer.current);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const live = data?.source === "live";
  const gained = data?.views !== null && data?.views !== undefined && first.current !== null ? data.views - first.current : 0;
  const max = Math.max(1, ...(data?.platforms.map((p) => p.views ?? 0) ?? [1]));

  return (
    <Tile label="Live views" delay={delay} className={className}>
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            {live && <span className="pr-ping absolute inline-flex h-full w-full rounded-full" style={{ background: "hsl(var(--success))" }} />}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: live ? "hsl(var(--success))" : "hsl(var(--muted-foreground))" }} />
          </span>
          {live ? "Live views" : data?.source === "stored" ? "Views, synced" : "Views"}
        </p>
        {data && <span className="text-sm text-muted-foreground">Updated {ago(data.fetchedAt, now)}</span>}
      </div>
      <div className="mt-4 text-[clamp(2.6rem,6vw,4.4rem)] font-semibold tracking-tight" aria-live="polite" aria-atomic="true">
        {data?.views !== null && data?.views !== undefined ? (
          <Odometer value={data.views} label={`${data.views.toLocaleString("en-US")} views in the last ${data.windowDays} days`} />
        ) : data ? (
          <span className="text-2xl text-muted-foreground">No views yet</span>
        ) : failed ? (
          <span className="flex items-center gap-2 text-xl text-muted-foreground"><CircleAlert className="h-5 w-5" aria-hidden="true" /> Couldn&apos;t load. Trying again shortly.</span>
        ) : (
          <span className="pr-shimmer inline-block h-14 w-56 rounded-2xl" aria-hidden="true" />
        )}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {data ? `Last ${data.windowDays} days${live ? ", straight from the platforms" : data.source === "stored" ? ", from posts published through Outlly" : ""}.` : "Checking your platforms…"}
        {gained > 0 && <span className="rounded-full bg-success/15 px-2 py-0.5 text-[13px] font-semibold text-success-ink">+{gained.toLocaleString("en-US")} since you opened this</span>}
      </p>
      {!!data?.platforms.length && (
        <ul className="mt-5 flex flex-col gap-2.5">
          {data.platforms.map((p) => (
            <li key={p.platform} className="flex items-center gap-3 text-[15px]">
              <PlatformOrb platform={p.platform} size={22} />
              <span className="w-24 shrink-0 truncate">{PLATFORM_META[p.platform].name}</span>
              <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                <motion.span className="absolute inset-y-0 left-0 rounded-full" style={{ background: PLATFORM_HALO[p.platform] }} initial={false} animate={{ width: `${((p.views ?? 0) / max) * 100}%` }} transition={{ duration: 0.9, ease: EASE }} />
              </span>
              <span className="tabular w-14 text-right font-medium">{p.views === null ? "--" : compact(p.views)}</span>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/* The bento                                                            */
/* ------------------------------------------------------------------ */

/** Each list card uses the same head: icon, h3, and a quiet count. */
function CardHead({ icon, title, tone }: { icon?: React.ReactNode; title: string; tone?: string }) {
  return (
    <h3 className="flex items-center gap-2 text-[17px] font-semibold">
      {icon && <span className={cn("flex h-7 w-7 items-center justify-center rounded-full bg-secondary", tone)} aria-hidden="true">{icon}</span>}
      {title}
    </h3>
  );
}

function Bullets({ items, dot }: { items: string[]; dot: string }) {
  return (
    <ul className="mt-4 flex flex-col gap-2.5 text-[15px] leading-relaxed">
      {items.map((s, i) => (
        <li key={i} className="flex gap-2.5">
          <span className={cn("mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full", dot)} aria-hidden="true" />
          {s}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* The page                                                             */
/* ------------------------------------------------------------------ */

/** The method in plain words, so a score is never a black box (1140). */
function Method({ sample }: { sample: number }) {
  return (
    <div className="mt-3 space-y-2 text-[15px] leading-relaxed text-muted-foreground">
      <p>Every number here comes from your connected accounts and from the posts you published through Outlly. Nothing is estimated and nothing is compared with other people.</p>
      <p>The score is the average of its parts, each marked out of 100 from your own numbers: how far your posts reach, how many people interact per view, how regularly you publish, and how your last {sample} posts moved against the period before.</p>
      <p>A part with no data is left out of the average rather than counted as zero. Followers and reach are never added together across platforms, because each platform counts them its own way.</p>
      <p>The written review is Pip AI reading exactly these numbers. It is told to use nothing else, so if a number is missing it says so instead of filling the gap.</p>
    </div>
  );
}

/**
 * The Profile Review workspace at /profile-review (1171; until then the last section of Analytics). The same
 * review, live counter and tiles as before, laid out as a page: score and live numbers first, then what the
 * score is made of and how each platform does, then what to do about it.
 *
 * The scope line says what the numbers cover. The review is worked out server side over every connected
 * account and the last 30 days (lib/live/review collectFacts); the page never pretends to filter what the
 * server has not filtered.
 */
export function ProfileReview() {
  const toast = useToast();
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reduce = useReducedMotion();

  const load = useCallback(() => {
    setError(null);
    swrApi<Loaded>("/api/analytics/review", setState).catch((e) => setError(e instanceof ApiError ? e.message : "The review couldn't load."));
  }, []);
  useEffect(load, [load]);

  const deep = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<Loaded>("/api/analytics/review", { method: "POST" });
      setState(r);
      toast("Your Pip AI review is ready.", "ok");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Pip AI didn't answer just now. Try again in a minute.", "error");
    } finally {
      setBusy(false);
    }
  };

  const r = state?.review;
  const thinking = busy || !state;
  const aiOn = !!state?.ai;
  const label = r?.source === "ai" ? `Written by Pip AI ${ago(r.generatedAt, Date.now())}` : "Worked out from your numbers";
  const stats = (r?.stats ?? []).filter((s) => s.key !== "views");
  const hasAudience = !!r && (!!r.audience || !!r.bestTimes || !!r.contentMix || r.source === "rules");
  const scopeNames = r?.platforms.map((p) => PLATFORM_META[p].name) ?? [];

  const action = (
    <button
      type="button"
      onClick={deep}
      disabled={busy || !aiOn || r?.empty}
      aria-busy={busy}
      title={!aiOn ? "The Pip AI deep review is not switched on for this workspace yet." : undefined}
      className="pr-ai-btn inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-55"
    >
      {busy ? <RefreshCw className={cn("h-4 w-4", !reduce && "animate-spin")} aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
      {busy ? "Pip AI is reading your numbers…" : r?.source === "ai" ? (state?.stale ? "Numbers moved: analyse again" : "Analyse again") : "Analyse with Pip AI"}
    </button>
  );

  const head = (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-2xl">
        <p className="ai-kicker text-sm font-semibold">Profile review</p>
        <h1 id="pr-title" className="display mt-1 text-[clamp(1.8rem,3.2vw,2.5rem)]">Profile Review</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">Understand what&apos;s working, what&apos;s holding you back, and what to improve next.</p>
        {!aiOn && state && <p className="mt-1 text-sm text-muted-foreground">Worked out from your real numbers. The in-depth Pip AI review needs an AI key on the server.</p>}
        {/* What the numbers cover, said once: every tile below shares this scope. */}
        <dl className="mt-4 flex flex-wrap gap-2 text-[13px]" aria-label="What this review covers" data-testid="review-scope">
          <div className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-secondary/70 px-3 hairline">
            <dt className="text-muted-foreground">Accounts</dt>
            <dd className="font-semibold">{r ? (scopeNames.length ? `All connected: ${scopeNames.join(", ")}` : "Posts published through Outlly") : "Loading"}</dd>
          </div>
          <div className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-secondary/70 px-3 hairline">
            <dt className="text-muted-foreground">Period</dt>
            <dd className="font-semibold">Last 30 days</dd>
          </div>
        </dl>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {r && <span className="text-sm text-muted-foreground">{label}</span>}
        {!error && action}
      </div>
    </header>
  );

  if (error)
    return (
      <section aria-labelledby="pr-title" className="ai-type">
        {head}
        <div className="glass mt-6 flex flex-col gap-4 rounded-[24px] p-5 sm:flex-row sm:items-center sm:p-6" role="alert">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary" aria-hidden="true">
            <CircleAlert className="h-5 w-5" />
          </span>
          <p className="min-w-0 flex-1 text-[15px]">
            <span className="block font-semibold">The review didn&apos;t load.</span>
            <span className="text-muted-foreground">{error}</span>
          </p>
          <button type="button" onClick={load} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-5 text-sm font-semibold hairline transition hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
          </button>
        </div>
      </section>
    );

  const showNext = !!r && !r.empty;
  return (
    <section aria-labelledby="pr-title" className="ai-type" aria-busy={thinking}>
      {head}

      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* Row 1: the score, the live counter, and the key numbers. */}
        <Tile label="Overall score" className="lg:col-span-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <ScoreRing score={r?.score ?? null} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-muted-foreground">{r?.grade ?? "Scoring"}</p>
              {r ? <p className="mt-1.5 text-[clamp(1.2rem,1.8vw,1.45rem)] font-semibold leading-snug tracking-tight">{r.headline}</p> : <div className="mt-3"><Shimmer lines={2} /></div>}
              <div className="mt-3 max-w-prose text-[15px] leading-relaxed text-muted-foreground">{busy ? <Shimmer lines={3} /> : r?.summary}</div>
            </div>
          </div>
          {busy && (
            <div className="mt-5 flex items-center gap-3 text-[15px] text-muted-foreground" role="status">
              <Pip size={44} mood="think" /> Reading {r?.sample ?? 0} posts and your stats…
            </div>
          )}
          {r && !busy && r.sample > 0 && <p className="mt-5 text-sm text-muted-foreground">Based on {r.sample} posts{r.platforms.length ? ` across ${r.platforms.map((p) => PLATFORM_META[p].name).join(", ")}` : ""}.</p>}
        </Tile>

        <LiveViews delay={0.05} className="lg:col-span-6 xl:col-span-3" />

        {(stats.length > 0 || !r) && (
          <Tile label="Followers and engagement" delay={0.08} className="lg:col-span-12 xl:col-span-3">
            <CardHead title="Key numbers" />
            {!r ? (
              <div className="mt-4 grid grid-cols-2 gap-6 xl:grid-cols-1">{Array.from({ length: 2 }, (_, i) => <Shimmer key={i} lines={3} />)}</div>
            ) : (
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-1">
                {stats.map((s) => (
                  <div key={s.key} className="min-w-0">
                    <dt className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                      <span className="truncate">{s.label}</span>
                      <Delta value={s.delta} />
                    </dt>
                    <dd className="mt-1.5">
                      <span className="block text-[clamp(1.5rem,2vw,1.85rem)] font-semibold leading-none tracking-tight">
                        <AnimatedNumber value={s.value} format={fmtStat(s)} tier={s.format === "pct" ? "pct" : "secondary"} />
                      </span>
                      <span className="mt-1.5 block text-sm text-muted-foreground">{s.hint}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Tile>
        )}

        {/* Row 2: what the score is made of, and how each platform does. */}
        {r && r.pillars.length > 0 && (
          <Tile label="What the score is made of" className={r.perPlatform.length > 0 ? "lg:col-span-7" : "lg:col-span-12"} delay={0.1}>
            <CardHead title="What the score is made of" />
            <ul className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
              {r.pillars.map((p, i) => (
                <li key={p.key} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3 text-[15px]">
                    <span className="font-medium">{p.label}</span>
                    <span className="tabular font-semibold">{p.score}<span className="font-normal text-muted-foreground">/100</span></span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.score} aria-label={`${p.label} ${p.score} out of 100`}>
                    <motion.div className="pr-meter h-full rounded-full" initial={{ width: reduce ? `${p.score}%` : 0 }} whileInView={{ width: `${p.score}%` }} viewport={{ once: true }} transition={{ duration: reduce ? 0 : 1, ease: EASE, delay: reduce ? 0 : 0.1 * i }} />
                  </div>
                  <p className="mt-1.5 text-sm leading-snug text-muted-foreground">{p.note}</p>
                </li>
              ))}
            </ul>
          </Tile>
        )}

        {r && r.perPlatform.length > 0 && (
          <Tile label="By platform" className={r.pillars.length > 0 ? "lg:col-span-5" : "lg:col-span-12"} delay={0.12}>
            <CardHead title="By platform" icon={<LayoutGrid className="h-4 w-4" />} />
            <p className="mt-1 text-sm text-muted-foreground">Each platform is scored on its own numbers. They are never added together.</p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {r.perPlatform.map((p) => (
                <li key={p.platform} className="flex gap-3 rounded-2xl bg-secondary/50 p-3.5">
                  <PlatformOrb platform={p.platform} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 text-[15px]">
                      <span className="font-semibold">{PLATFORM_META[p.platform].name}</span>
                      {p.score !== null && <span className="tabular font-semibold">{p.score}<span className="font-normal text-muted-foreground">/100</span></span>}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{busy ? <span className="pr-shimmer inline-block h-3 w-40 rounded-full" /> : p.verdict}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Tile>
        )}

        {showNext && (
          <>
            {/* Row 3: what to do about it. Actions first: this is what the review is for. */}
            <Tile label="Do this next" className="lg:col-span-12 xl:col-span-6" delay={0.14}>
              <CardHead title="Do this next" icon={<Sparkles className="h-4 w-4" />} />
              <ol className="mt-3 flex flex-col gap-1">
                {r.actions.map((a, i) => (
                  <li key={i}>
                    <Link href={a.href ?? "/create"} className="group flex min-h-11 gap-3 rounded-2xl p-3 transition hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--ring))]">
                      <span className="tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold" aria-hidden="true">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                          {a.title}
                          <span className={cn("rounded-full px-2 py-0.5 text-[13px] font-semibold", a.impact === "high" ? "bg-success/15 pr-good" : a.impact === "medium" ? "bg-secondary text-foreground" : "bg-secondary text-muted-foreground")}>{a.impact} impact</span>
                        </span>
                        <span className="mt-1 block text-[15px] leading-relaxed text-muted-foreground">{a.body}</span>
                        {a.evidence && <span className="mt-1 block text-sm text-muted-foreground">From: {a.evidence}</span>}
                      </span>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ol>
            </Tile>

            <Tile label="Working for you" className="lg:col-span-6 xl:col-span-3" delay={0.16}>
              <CardHead title="Working for you" icon={<Check className="h-4 w-4" />} tone="text-success-ink" />
              {busy ? <div className="mt-4"><Shimmer /></div> : r.strengths.length ? <Bullets items={r.strengths} dot="bg-success" /> : <p className="mt-4 text-[15px] text-muted-foreground">Nothing scores above 60 yet. The steps above are the fastest way to get there.</p>}
            </Tile>
            <Tile label="Holding you back" className="lg:col-span-6 xl:col-span-3" delay={0.18}>
              <CardHead title="Holding you back" icon={<TriangleAlert className="h-4 w-4" />} tone="text-warning-ink" />
              {busy ? <div className="mt-4"><Shimmer /></div> : r.weaknesses.length ? <Bullets items={r.weaknesses} dot="bg-warning" /> : <p className="mt-4 text-[15px] text-muted-foreground">No pillar is below 45. Keep the rhythm going.</p>}
            </Tile>

            {/* Last: who watches and when, and how all of this is worked out. */}
            {hasAudience && (
              <Tile label="Audience and timing" className="lg:col-span-6" delay={0.2}>
                <CardHead title="Audience and timing" icon={<Users className="h-4 w-4" />} />
                <dl className="mt-4 flex flex-col gap-4 text-[15px]">
                  <div>
                    <dt className="font-semibold">Who watches</dt>
                    <dd className="mt-1 leading-relaxed text-muted-foreground">{busy ? <Shimmer lines={2} /> : r.audience ?? "Run the Pip AI review to read what your numbers say about who watches."}</dd>
                  </div>
                  {r.bestTimes && (
                    <div>
                      <dt className="flex items-center gap-2 font-semibold"><Clock className="h-4 w-4" aria-hidden="true" /> Best time</dt>
                      <dd className="mt-1 leading-relaxed text-muted-foreground">{r.bestTimes}</dd>
                    </div>
                  )}
                  {r.contentMix && (
                    <div>
                      <dt className="font-semibold">Content mix</dt>
                      <dd className="mt-1 leading-relaxed text-muted-foreground">{r.contentMix}</dd>
                    </div>
                  )}
                </dl>
              </Tile>
            )}
            <Tile label="How this is worked out" className={hasAudience ? "lg:col-span-6" : "lg:col-span-12"} delay={0.22}>
              <CardHead title="How this is worked out" />
              <Method sample={r.sample} />
            </Tile>
          </>
        )}

        {r?.empty && (
          <Tile label="Nothing to review yet" className="lg:col-span-12" delay={0.1}>
            <p className="text-[15px] leading-relaxed text-muted-foreground">There is not enough to review yet. Connect an account or publish a few posts through Outlly, and the score, the numbers and what to do next fill in here.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/accounts" className="inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold hairline transition hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]">Connect an account</Link>
              <Link href="/create" className="inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold hairline transition hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]">Make your first one</Link>
            </div>
          </Tile>
        )}
      </div>
    </section>
  );
}
