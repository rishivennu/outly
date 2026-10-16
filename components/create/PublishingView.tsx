"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, LayoutGrid, Link2, Plus, RefreshCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pip } from "@/components/brand/Pip";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORM_META, STOPPABLE, TARGET_COPY, type TargetStatus } from "@/lib/domain";
import { targetErrorCopy } from "@/components/shared/errorCopy";
import { cn } from "@/lib/utils";
import { DancingPip, MusicToggle, useGroove } from "./Groove";
import type { PostView, TargetView } from "./types";

/**
 * "Sending it out": one glowing glass card per destination, side by side (a lone card sits in the middle).
 * Each card carries the platform's own logo, what's happening in words, a progress bar, and the one action
 * that matters right now: Stop while it's still moving, Send it again when it stopped, See it once it's live.
 * The glow at the foot of a card is the status colour and rises as the upload moves; text always carries the state.
 * Pip dances to the groove up top while anything is still moving. This is the only screen that plays music.
 */
const ACTIVE: TargetStatus[] = ["pending", "queued", "uploading", "processing"];
const STEPS = ["Queued", "Sending", "Processing", "Live"] as const;
const STEP_OF: Record<string, number> = { pending: 0, queued: 0, uploading: 1, processing: 2, published: 3, failed: 3 };
const ROW_COPY: Record<string, string> = {
  pending: "Waiting its turn.",
  queued: "Lined up, starting in a moment.",
  uploading: "Sending your video.",
  processing: "Getting it ready to go public.",
  published: "It's live. Go say hi in the comments.",
};
const TITLE: Record<string, string> = { pending: "Waiting", queued: "Queued", uploading: "Sending", processing: "Going public", published: "Live" };
/** Each status owns a slice of the track; inside it the fill eases forward so slow platforms still look alive. */
const BAND: Record<string, [number, number, number]> = { pending: [3, 8, 30], queued: [8, 18, 20], uploading: [18, 62, 22], processing: [62, 94, 30] };
/** Glow tone per state, all from the Outlly palette (see .lv-* in globals.css). */
const TONE: Record<string, string> = { pending: "wait", queued: "wait", uploading: "send", processing: "send", published: "live", failed: "bad" };
const POLL_MS = 1500;

export function PublishingView({ initial, onAnother }: { initial: PostView; onAnother: () => void }) {
  const [post, setPost] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const reduce = useReducedMotion();
  const active = post.targets.some((t) => ACTIVE.includes(t.status as TargetStatus));
  const stoppable = post.targets.filter((t) => STOPPABLE.includes(t.status as TargetStatus));
  const g = useGroove(active);

  /** Signed out or the post is gone: no point asking again. */
  const [pollDead, setPollDead] = useState(false);
  const refresh = useCallback(async () => {
    if (document.hidden) return; // a background tab doesn't need second-by-second updates
    try {
      const r = await api<{ post: PostView }>(`/api/posts/${post.id}`);
      setPost(r.post);
    } catch (e) {
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) setPollDead(true);
      /* anything else is transient; next tick tries again */
    }
  }, [post.id]);

  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);
  // Fast while it's fresh, then easy on the server for a platform that takes its time.
  const slow = now - t0 > 120_000;

  useEffect(() => {
    if (!active || pollDead) return;
    const id = setInterval(refresh, slow ? 6000 : POLL_MS);
    const onShow = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [active, refresh, slow, pollDead]);

  useEffect(() => {
    if (!stoppable.length) setConfirmAll(false);
  }, [stoppable.length]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  const elapsed = Math.max(0, Math.floor((now - t0) / 1000));
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  // When did each target enter its current status? Drives the eased fill inside its band.
  const since = useRef<Record<string, { s: string; at: number; pct: number }>>({});
  const pctOf = (t: TargetView) => {
    const prev = since.current[t.id];
    if (!prev || prev.s !== t.status) since.current[t.id] = { s: t.status, at: now, pct: prev?.pct ?? 0 };
    const rec = since.current[t.id];
    let p: number;
    if (t.status === "published") p = 100;
    else if (t.status === "failed") p = Math.max(rec.pct, 12);
    else {
      const [lo, hi, tau] = BAND[t.status] ?? BAND.pending;
      p = lo + (hi - lo) * (1 - Math.exp(-Math.max(0, now - rec.at) / 1000 / tau));
    }
    if (t.status !== "failed") rec.pct = p;
    return Math.round(p);
  };

  const published = post.targets.filter((t) => t.status === "published");
  const failed = post.targets.filter((t) => t.status === "failed");
  const stopped = failed.filter((t) => t.errorCode === "CANCELED");
  const allLive = !active && published.length === post.targets.length;
  const allStopped = !active && stopped.length === post.targets.length;
  const headline = active ? "Sending it out" : allLive ? "You're live." : allStopped ? "Stopped. Nothing went out." : published.length ? "Almost everywhere." : "Something got in the way.";
  const sub = active
    ? "Each platform moves at its own pace. You can leave this page; we'll keep going."
    : allLive
      ? `Out on ${published.map((t) => PLATFORM_META[t.platform].name).join(" and ")}. Go say hi in the comments.`
      : allStopped
        ? "You stopped every upload. Send any of them again whenever you're ready."
        : published.length
          ? `${failed.length === 1 ? "One place needs" : "A couple of places need"} a hand. Everything else is live.`
          : "Nothing went out yet. Each card says what happened and how to fix it.";
  const summary = allLive || active ? `${published.length} of ${post.targets.length} live` : `${published.length} live, ${failed.length} to fix`;

  const act = async (key: string, path: string) => {
    setBusy(key);
    setErr(null);
    try {
      const r = await api<{ post: PostView }>(path, { method: "POST" });
      setPost(r.post);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something got in the way.");
      void refresh();
    } finally {
      setBusy(null);
    }
  };
  const retry = (t: TargetView) => act(t.id, `/api/targets/${t.id}/retry`);
  const stop = (t: TargetView) => act(t.id, `/api/targets/${t.id}/cancel`);
  const stopAll = async () => {
    setConfirmAll(false);
    await act("all", `/api/posts/${post.id}/cancel`);
  };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="relative text-center">
        <p className="sr-only" role="status" aria-live="polite">{`${headline}. ${summary}.`}</p>
        <div className="mb-3 flex h-[104px] items-end justify-center">
          {active ? <DancingPip size={92} /> : <Pip size={92} mood={allLive ? "happy" : "sad"} />}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <p className="pub-eyebrow inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em]">
            {active ? <span className={cn("pub-pulse", reduce && "pub-pulse-still")} aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {summary}
            {active && <span className="font-mono tabular-nums normal-case tracking-normal text-muted-foreground" aria-hidden="true">{clock}</span>}
          </p>
          {active && <MusicToggle g={g} />}
          {stoppable.length > 1 &&
            (confirmAll ? (
              <span className="inline-flex flex-wrap items-center gap-1.5 rounded-full bg-card p-1 pl-3 text-xs font-semibold hairline" role="group" aria-label="Stop every upload?">
                Stop {stoppable.length} uploads?
                <button type="button" onClick={stopAll} disabled={busy === "all"} className="lv-stop-yes inline-flex h-11 items-center rounded-full px-4">
                  Yes, stop all
                </button>
                <button type="button" onClick={() => setConfirmAll(false)} className="inline-flex h-11 items-center rounded-full px-3 hover:bg-secondary">
                  Keep going
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmAll(true)} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-card px-4 text-xs font-semibold hairline hover:bg-secondary">
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> Stop all uploads
              </button>
            ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.h1 key={headline} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className={cn("display mt-4 text-[clamp(2.2rem,6vw,3.6rem)]", allLive && "energy-text")}>
            {headline}
            {active && <span className={cn("pub-dots", reduce && "pub-dots-still")} aria-hidden="true"><i /><i /><i /></span>}
          </motion.h1>
        </AnimatePresence>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">{sub}</p>
        {allLive && !reduce && <Burst />}
      </header>

      <ul aria-label="Where your video is going" className="mt-10 flex flex-wrap justify-center gap-5">
        {post.targets.map((t, i) => (
          <LiveCard key={t.id} t={t} i={i} pct={pctOf(t)} post={post} busy={busy === t.id || busy === "all"} onRetry={() => retry(t)} onStop={() => stop(t)} reduce={!!reduce} />
        ))}
      </ul>

      {err && (
        <p role="alert" className="mt-4 text-center text-sm text-destructive">
          {err}
        </p>
      )}

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-10 flex flex-wrap justify-center gap-3">
        {!active ? (
          <>
            <Button asChild variant="primary" size="lg">
              <Link href="/content">
                <LayoutGrid className="h-5 w-5" /> See your content
              </Link>
            </Button>
            <Button variant="subtle" size="lg" onClick={onAnother}>
              <Plus className="h-5 w-5" /> Create another
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="lg" onClick={onAnother}>
            <Plus className="h-5 w-5" /> Start the next one while this sends
          </Button>
        )}
      </motion.div>
    </div>
  );
}

function LiveCard({ t, i, pct, post, busy, onRetry, onStop, reduce }: { t: TargetView; i: number; pct: number; post: PostView; busy: boolean; onRetry: () => void; onStop: () => void; reduce: boolean }) {
  const meta = PLATFORM_META[t.platform];
  const canceled = t.status === "failed" && t.errorCode === "CANCELED";
  const h = t.status === "failed" ? targetErrorCopy(t.platform, t.errorCode) : null;
  const step = STEP_OF[t.status] ?? 0;
  const isActive = ACTIVE.includes(t.status as TargetStatus);
  const canStop = STOPPABLE.includes(t.status as TargetStatus);
  const live = t.status === "published";
  const bad = t.status === "failed";
  const tone = canceled ? "off" : (TONE[t.status] ?? "wait");
  const returnTo = encodeURIComponent(`/create?post=${post.id}`);
  const name = post.title || post.media.filename || "Untitled";
  const line = h ? h.title : (ROW_COPY[t.status] ?? TARGET_COPY[t.status as TargetStatus] ?? t.status);
  const stepLine = live ? "Landed" : canceled ? "Stopped by you" : bad ? "Needs a hand" : `Step ${step + 1} of 4${t.attempts > 1 ? `, try ${t.attempts}` : ""}`;
  const light = t.platform === "x" || t.platform === "threads";

  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 28, delay: reduce ? 0 : i * 0.08 }}
      className={cn("lv-card w-full sm:w-[calc(50%-0.625rem)] lg:w-[calc(33.333%-0.834rem)] xl:w-[calc(25%-0.9375rem)]", `lv-${tone}`, isActive && !reduce && "lv-moving")}
      style={{ ["--p" as string]: pct }}
    >
      <span className="lv-glow" aria-hidden="true" />
      <span className="lv-rim" aria-hidden="true" />
      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <span className="lv-tile">
            <PlatformOrb platform={t.platform} size={44} square className={cn(light && "!bg-white !text-black", t.status === "pending" && "opacity-70")} />
          </span>
          <span className="lv-chip">{canceled ? "Stopped" : bad ? "Needs a hand" : (TITLE[t.status] ?? t.status)}</span>
        </div>

        <h2 className="mt-6 text-[1.7rem] font-semibold leading-[1.1] tracking-[-0.02em]">
          {meta.name} <span className="text-white/55">{meta.format}</span>
        </h2>
        <p className="mt-2 text-[15px] leading-snug text-white/75">{line}</p>
        <p className="mt-2 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60" title={name}>
          {name}
        </p>

        <div
          className="lv-track mt-5"
          role="progressbar"
          aria-label={`${meta.name} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${meta.name}: ${canceled ? "stopped by you" : bad ? "stopped, needs a hand" : `${STEPS[step]}, step ${step + 1} of 4`}`}
        >
          <span className="lv-fill" style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
        <p className="mt-2 flex items-center justify-between text-xs font-semibold text-white/70">
          <span>{stepLine}</span>
          {!live && !bad && <span className="font-mono tabular-nums">{pct}%</span>}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
          {live && t.url ? (
            <a href={t.url} target="_blank" rel="noopener noreferrer" className="lv-cta">
              See it on {meta.name} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : live ? (
            <span className="lv-cta lv-cta-quiet">Live on {meta.name}</span>
          ) : h?.kind === "reconnect" ? (
            <>
              <a href={`/api/accounts/${t.platform}/connect?returnTo=${returnTo}`} className="lv-cta">
                <Link2 className="h-4 w-4" aria-hidden="true" /> {h.action} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <button type="button" onClick={onRetry} disabled={busy} className="lv-cta lv-cta-quiet">
                Already reconnected? Try again
              </button>
            </>
          ) : bad ? (
            <button type="button" onClick={onRetry} disabled={busy} className="lv-cta">
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden="true" /> {h?.action ?? "Try again"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">on {meta.name}</span>
            </button>
          ) : canStop ? (
            <button type="button" onClick={onStop} disabled={busy} className="lv-cta lv-cta-stop">
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> {busy ? "Stopping" : "Stop this upload"}
              <span className="sr-only">to {meta.name}</span>
            </button>
          ) : (
            <span className="lv-cta lv-cta-quiet">Going public now, it can&apos;t be stopped</span>
          )}
        </div>

        {bad && !canceled && (
          <details className="group mt-2 text-xs text-white/70">
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1 font-medium hover:text-white">
              Technical details <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <dl className="space-y-1 rounded-xl bg-black/40 p-3 font-mono text-[11px] leading-relaxed">
              <div>
                <dt className="inline text-white/80">code: </dt>
                <dd className="inline">{t.errorCode ?? "UNKNOWN"}</dd>
              </div>
              {t.errorDetail && (
                <div>
                  <dt className="inline text-white/80">detail: </dt>
                  <dd className="inline break-words">{t.errorDetail}</dd>
                </div>
              )}
              <div>
                <dt className="inline text-white/80">attempts: </dt>
                <dd className="inline">{t.attempts}</dd>
              </div>
            </dl>
          </details>
        )}
        <span className="min-h-[5.5rem] flex-1" aria-hidden="true" />
      </div>
    </motion.li>
  );
}

function Burst() {
  const bits = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        const a = (i / 30) * Math.PI * 2 + Math.random() * 0.4;
        const r = 120 + Math.random() * 160;
        return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7, c: ["--lime", "--energy-a", "--energy-b", "--energy-c", "--success"][i % 5], s: 6 + Math.random() * 6, rot: Math.random() * 360, round: i % 3 === 0 };
      }),
    [],
  );
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/3" aria-hidden="true">
      {bits.map((b, i) => (
        <motion.span
          key={i}
          className={cn("absolute block", b.round ? "rounded-full" : "rounded-[2px]")}
          style={{ width: b.s, height: b.round ? b.s : b.s * 0.45, background: `hsl(var(${b.c}))` }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.4 }}
          animate={{ x: b.x, y: [0, b.y, b.y + 80], opacity: [1, 1, 0], rotate: b.rot, scale: 1 }}
          transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
    </div>
  );
}
