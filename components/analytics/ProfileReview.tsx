"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, Clock, RefreshCw, Sparkles, TriangleAlert, Users } from "lucide-react";
import { Pip } from "@/components/brand/Pip";
import { PlatformOrb, PLATFORM_HALO } from "@/components/shared/PlatformIcon";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORM_META } from "@/lib/domain";
import { cn, compact } from "@/lib/utils";
import type { ProfileReview as Review, ReviewStat } from "@/lib/live/review-core";
import type { LiveTotals } from "@/lib/live/review";

type Loaded = { review: Review; ai: boolean; stale: boolean; nextRegenAt?: string | null };
const POLL_MS = 30_000;
const EASE = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/* Small animated pieces                                                */
/* ------------------------------------------------------------------ */

/** Counts from the last shown value to the new one, so live updates roll forward instead of restarting at 0. */
function Count({ value, format = compact, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const from = useRef(0);
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      from.current = value;
      return setShown(value);
    }
    const c = animate(from.current, value, { duration: 1.2, ease: EASE, onUpdate: (v) => ((from.current = v), setShown(v)) });
    return () => c.stop();
  }, [inView, value, reduce]);
  return <span ref={ref} className={cn("tabular", className)}>{format(shown)}</span>;
}

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
                style={{ transform: `translateY(-${Number(ch) * 10}%)`, transition: reduce ? "none" : "transform 900ms cubic-bezier(.22,1,.36,1)" }}
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
    <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold", flat ? "bg-secondary text-muted-foreground" : up ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
      {!flat && (up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />)}
      <span className="sr-only">{flat ? "About the same as before" : up ? "Up" : "Down"}</span>
      {flat ? "Flat" : `${Math.abs(value) < 10 ? Math.abs(value).toFixed(1) : Math.round(Math.abs(value))}${suffix}`}
    </span>
  );
}

function ScoreRing({ score, size = 168 }: { score: number | null; size?: number }) {
  const id = useId();
  const reduce = useReducedMotion();
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : score / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--energy-a))" />
            <stop offset="60%" stopColor="hsl(var(--energy-b))" />
            <stop offset="100%" stopColor="hsl(var(--energy-c))" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--foreground) / 0.08)" strokeWidth={12} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id}-g)`}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? c * (1 - pct) : c }}
          whileInView={{ strokeDashoffset: c * (1 - pct) }}
          viewport={{ once: true }}
          transition={{ duration: reduce ? 0 : 1.4, ease: EASE }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {score === null ? <span className="text-2xl font-semibold text-muted-foreground">--</span> : <Count value={score} format={(n) => String(Math.round(n))} className="text-5xl font-semibold tracking-tight" />}
        <span className="mt-1 text-xs text-muted-foreground">out of 100</span>
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
      initial={reduce ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, ease: EASE, delay: reduce ? 0 : delay }}
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

function LiveViews({ delay }: { delay: number }) {
  const [data, setData] = useState<LiveTotals | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const first = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    try {
      const d = await api<LiveTotals>("/api/analytics/live");
      setData(d);
      setFailed(false);
      if (first.current === null && d.views !== null) first.current = d.views;
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const loop = async () => {
      if (!document.hidden) await load();
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
    <Tile label="Live views" delay={delay} className="md:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            {live && <span className="pr-ping absolute inline-flex h-full w-full rounded-full" style={{ background: "hsl(var(--success))" }} />}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: live ? "hsl(var(--success))" : "hsl(var(--muted-foreground))" }} />
          </span>
          {live ? "Live views" : data?.source === "stored" ? "Views, synced" : "Views"}
        </p>
        {data && <span className="text-xs text-muted-foreground">Updated {ago(data.fetchedAt, now)}</span>}
      </div>
      <div className="mt-4 text-[clamp(2.6rem,6vw,4.4rem)] font-semibold tracking-tight" aria-live="polite" aria-atomic="true">
        {data?.views !== null && data?.views !== undefined ? (
          <Odometer value={data.views} label={`${data.views.toLocaleString("en-US")} views in the last ${data.windowDays} days`} />
        ) : data ? (
          <span className="text-2xl text-muted-foreground">No views yet</span>
        ) : failed ? (
          <span className="text-2xl text-muted-foreground">Couldn&apos;t load</span>
        ) : (
          <span className="pr-shimmer inline-block h-14 w-56 rounded-2xl" aria-hidden="true" />
        )}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {data ? `Last ${data.windowDays} days${live ? ", straight from the platforms" : data.source === "stored" ? ", from posts published through Outlly" : ""}.` : "Checking your platforms..."}
        {gained > 0 && <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">+{gained.toLocaleString("en-US")} since you opened this</span>}
      </p>
      {!!data?.platforms.length && (
        <ul className="mt-5 flex flex-col gap-2.5">
          {data.platforms.map((p) => (
            <li key={p.platform} className="flex items-center gap-3 text-sm">
              <PlatformOrb platform={p.platform} size={22} />
              <span className="w-20 shrink-0">{PLATFORM_META[p.platform].name}</span>
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

export function ProfileReview({ compactMode = false }: { compactMode?: boolean }) {
  const toast = useToast();
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    api<Loaded>("/api/analytics/review").then(setState, (e) => setError(e instanceof ApiError ? e.message : "The review couldn't load."));
  }, []);

  const deep = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<Loaded>("/api/analytics/review", { method: "POST" });
      setState(r);
      toast("Your Gemini review is ready.", "ok");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Gemini didn't answer just now. Try again in a minute.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (error)
    return (
      <div className="glass mt-8 rounded-[28px] p-6 text-sm text-muted-foreground" role="alert">
        {error}
      </div>
    );

  const r = state?.review;
  const thinking = busy || !state;
  const aiOn = !!state?.ai;
  const label = r?.source === "ai" ? `Written by Gemini ${ago(r.generatedAt, Date.now())}` : "Worked out from your numbers";
  const action = (
    <button
      type="button"
      onClick={deep}
      disabled={busy || !aiOn || r?.empty}
      aria-busy={busy}
      title={!aiOn ? "The Gemini deep review is not switched on for this workspace yet." : undefined}
      className="pr-ai-btn inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-55"
    >
      {busy ? <RefreshCw className={cn("h-4 w-4", !reduce && "animate-spin")} aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
      {busy ? "Gemini is reading your numbers..." : r?.source === "ai" ? (state?.stale ? "Numbers moved: analyse again" : "Analyse again") : "Analyse with Gemini"}
    </button>
  );

  return (
    <section aria-labelledby="pr-title" className={cn("ai-type", compactMode ? "" : "mt-10")} aria-busy={thinking}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow ai-kicker">Profile review</p>
          <h2 id="pr-title" className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">How your profile is really doing</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {r && <span className="text-xs text-muted-foreground">{label}</span>}
          {action}
        </div>
      </div>
      {!aiOn && state && <p className="mt-2 text-xs text-muted-foreground">The in-depth Gemini review needs a Gemini key on the server. Everything below is still worked out from your real numbers.</p>}

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
        {/* Score */}
        <Tile label="Overall score" className="md:col-span-2 md:row-span-2">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <ScoreRing score={r?.score ?? null} />
            <div className="min-w-0">
              <p className="eyebrow">{r?.grade ?? "Scoring"}</p>
              {r ? <p className="mt-2 text-xl font-semibold leading-snug">{r.headline}</p> : <div className="mt-3"><Shimmer lines={2} /></div>}
            </div>
          </div>
          <div className="mt-5 text-[15px] leading-relaxed text-muted-foreground">{busy ? <Shimmer lines={4} /> : r?.summary}</div>
          {busy && (
            <div className="mt-5 flex items-center gap-3 text-sm text-muted-foreground" role="status">
              <Pip size={44} mood="think" /> Reading {r?.sample ?? 0} posts and your stats...
            </div>
          )}
          {r && !compactMode && r.pillars.length > 0 && (
            <div className="mt-6 border-t border-[hsl(var(--glass-border))] pt-5">
              <h3 className="text-sm font-semibold">What the score is made of</h3>
              <ul className="mt-3 flex flex-col gap-3.5">
                {r.pillars.map((p, i) => (
                  <li key={p.key}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">{p.label}</span>
                      <span className="tabular font-semibold">{p.score}</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.score} aria-label={`${p.label} ${p.score} out of 100`}>
                      <motion.div className="energy-bg h-full rounded-full" initial={{ width: reduce ? `${p.score}%` : 0 }} whileInView={{ width: `${p.score}%` }} viewport={{ once: true }} transition={{ duration: reduce ? 0 : 1, ease: EASE, delay: reduce ? 0 : 0.1 * i }} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{p.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r && !busy && r.sample > 0 && <p className="mt-5 text-xs text-muted-foreground">Based on {r.sample} posts{r.platforms.length ? ` across ${r.platforms.map((p) => PLATFORM_META[p].name).join(", ")}` : ""}.</p>}
        </Tile>

        {/* Live views */}
        <LiveViews delay={0.05} />

        {/* Stat tiles */}
        {(r?.stats ?? []).filter((s) => s.key !== "views").slice(0, compactMode ? 2 : 4).map((s, i) => (
          <Tile key={s.key} label={s.label} delay={0.08 + i * 0.04}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <Delta value={s.delta} />
            </div>
            <p className="mt-2 text-3xl font-semibold tracking-tight">
              <Count value={s.value} format={fmtStat(s)} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
          </Tile>
        ))}
        {!r && Array.from({ length: 2 }, (_, i) => <Tile key={i}><Shimmer lines={3} /></Tile>)}

        {!compactMode && r && !r.empty && (
          <>
            {/* Per platform */}
            {r.perPlatform.length > 0 && (
              <Tile label="By platform" className="md:col-span-2" delay={0.12}>
                <h3 className="font-semibold">By platform</h3>
                <ul className="mt-4 flex flex-col gap-3">
                  {r.perPlatform.map((p) => (
                    <li key={p.platform} className="flex gap-3 rounded-2xl bg-secondary/50 p-3">
                      <PlatformOrb platform={p.platform} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{PLATFORM_META[p.platform].name}</span>
                          {p.score !== null && <span className="tabular text-sm font-semibold">{p.score}<span className="text-muted-foreground">/100</span></span>}
                        </div>
                        <p className="mt-0.5 text-sm text-muted-foreground">{busy ? <span className="pr-shimmer inline-block h-3 w-40 rounded-full" /> : p.verdict}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Tile>
            )}

            {/* Strengths and weaknesses */}
            <Tile label="Working for you" className="md:col-span-2" delay={0.14}>
              <h3 className="flex items-center gap-2 font-semibold"><Check className="h-4 w-4 text-success" aria-hidden="true" /> Working for you</h3>
              {busy ? <div className="mt-4"><Shimmer /></div> : r.strengths.length ? (
                <ul className="mt-3 flex flex-col gap-2 text-sm">{r.strengths.map((s, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />{s}</li>)}</ul>
              ) : <p className="mt-3 text-sm text-muted-foreground">Nothing scores above 60 yet. The actions below are the fastest way to get there.</p>}
            </Tile>
            <Tile label="Holding you back" className="md:col-span-2" delay={0.16}>
              <h3 className="flex items-center gap-2 font-semibold"><TriangleAlert className="h-4 w-4 text-warning" aria-hidden="true" /> Holding you back</h3>
              {busy ? <div className="mt-4"><Shimmer /></div> : r.weaknesses.length ? (
                <ul className="mt-3 flex flex-col gap-2 text-sm">{r.weaknesses.map((s, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />{s}</li>)}</ul>
              ) : <p className="mt-3 text-sm text-muted-foreground">No pillar is below 45. Keep the rhythm going.</p>}
            </Tile>

            {/* Audience, timing, content */}
            {(r.audience || r.bestTimes || r.contentMix || r.source === "rules") && (
              <Tile label="Audience and timing" className="md:col-span-2" delay={0.18}>
                <dl className="flex flex-col gap-4 text-sm">
                  <div>
                    <dt className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4" aria-hidden="true" /> Audience</dt>
                    <dd className="mt-1 text-muted-foreground">{busy ? <Shimmer lines={2} /> : r.audience ?? "Run the Gemini review to read what your numbers say about who watches."}</dd>
                  </div>
                  {r.bestTimes && (
                    <div>
                      <dt className="flex items-center gap-2 font-semibold"><Clock className="h-4 w-4" aria-hidden="true" /> Best time</dt>
                      <dd className="mt-1 text-muted-foreground">{r.bestTimes}</dd>
                    </div>
                  )}
                  {r.contentMix && (
                    <div>
                      <dt className="font-semibold">Content mix</dt>
                      <dd className="mt-1 text-muted-foreground">{r.contentMix}</dd>
                    </div>
                  )}
                </dl>
              </Tile>
            )}

            {/* Actions */}
            <Tile label="Do this next" className="md:col-span-2" delay={0.2}>
              <h3 className="font-semibold">Do this next</h3>
              <ol className="mt-4 flex flex-col gap-2">
                {r.actions.map((a, i) => (
                  <li key={i}>
                    <Link href={a.href ?? "/create"} className="group flex min-h-11 gap-3 rounded-2xl p-3 transition hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--ring))]">
                      <span className="tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold" aria-hidden="true">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          {a.title}
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", a.impact === "high" ? "bg-success/15 text-success" : a.impact === "medium" ? "bg-secondary text-foreground" : "bg-secondary text-muted-foreground")}>{a.impact} impact</span>
                        </span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">{a.body}</span>
                        {a.evidence && <span className="mt-1 block text-xs text-muted-foreground/80">From: {a.evidence}</span>}
                      </span>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ol>
            </Tile>
          </>
        )}

        {compactMode && r && (
          <Tile className="md:col-span-2 flex items-center">
            <Link href="/analytics#pr-title" className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--ring))]">
              <span>{r.actions[0] ? `Next: ${r.actions[0].title}` : "See the full review"}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Tile>
        )}
      </div>
    </section>
  );
}
