"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, ExternalLink, LayoutGrid, Link2, Plus, RefreshCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OutlyMark } from "@/components/brand/Logo";
import { Pip } from "@/components/brand/Pip";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { DotText } from "@/components/brand/DotText";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORM_META, STOPPABLE, TARGET_COPY, type Platform, type TargetStatus } from "@/lib/domain";
import { targetErrorCopy } from "@/components/shared/errorCopy";
import { cn } from "@/lib/utils";
import { DancingPip, MusicToggle, useGroove } from "./Groove";
import type { PostView, TargetView } from "./types";

/**
 * "Sending it out", styled as a Live Activity (10-16f: columns, side by side; a lone card sits in the middle).
 * Each destination is one dark slab: a dot-matrix route (YOU -> IG), a status box with the one action that matters,
 * and a glowing lime track with the Outlly rocket riding its tip. Stop while it's still moving, Send it again when
 * it stopped, See it once it's live. Text always carries the state; colour backs it up.
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
const CODE: Record<Platform, string> = { instagram: "IG", youtube: "YT", x: "X", tiktok: "TT", threads: "TH", facebook: "FB", linkedin: "IN" };
/** Each status owns a slice of the track; inside it the fill eases forward so slow platforms still look alive. */
const BAND: Record<string, [number, number, number]> = { pending: [3, 8, 30], queued: [8, 18, 20], uploading: [18, 62, 22], processing: [62, 94, 30] };
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

      <ul aria-label="Where your video is going" className="mx-auto mt-10 flex max-w-[56rem] flex-wrap justify-center gap-5">
        {post.targets.map((t, i) => (
          <LiveActivity key={t.id} t={t} i={i} pct={pctOf(t)} post={post} busy={busy === t.id || busy === "all"} onRetry={() => retry(t)} onStop={() => stop(t)} reduce={!!reduce} />
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

function LiveActivity({ t, i, pct, post, busy, onRetry, onStop, reduce }: { t: TargetView; i: number; pct: number; post: PostView; busy: boolean; onRetry: () => void; onStop: () => void; reduce: boolean }) {
  const meta = PLATFORM_META[t.platform];
  const canceled = t.status === "failed" && t.errorCode === "CANCELED";
  const h = t.status === "failed" && !canceled ? targetErrorCopy(t.platform, t.errorCode) : null;
  const step = STEP_OF[t.status] ?? 0;
  const isActive = ACTIVE.includes(t.status as TargetStatus);
  const canStop = STOPPABLE.includes(t.status as TargetStatus);
  const live = t.status === "published";
  const bad = t.status === "failed";
  const returnTo = encodeURIComponent(`/create?post=${post.id}`);
  const name = post.title || post.media.filename || "Untitled";
  const title = live ? "Live" : canceled ? "Stopped" : bad ? "Needs a hand" : (TITLE[t.status] ?? t.status);
  const statusLine = canceled ? `You stopped this one before it reached ${meta.name}.` : h ? h.title : (ROW_COPY[t.status] ?? TARGET_COPY[t.status as TargetStatus] ?? t.status);
  const accent = live
    ? "Live now"
    : canceled
      ? "Send it again anytime"
      : bad
        ? h?.kind === "reconnect"
          ? "Reconnect to finish"
          : "Tap retry to finish"
        : canStop
          ? `Step ${step + 1} of 4${t.attempts > 1 ? `, try ${t.attempts}` : ""}`
          : "Going public, can't stop now";

  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 28, delay: reduce ? 0 : i * 0.08 }}
      className={cn(
        "la-card la-col relative flex w-full flex-col overflow-hidden rounded-[2rem] p-5 text-white sm:w-[calc(50%-0.625rem)]",
        live && "la-live",
        bad && !canceled && "la-bad",
      )}
    >
      <span className="la-grid" aria-hidden="true" />
      <div className="relative flex items-center gap-3" aria-hidden="true">
        <DotText text="YOU" />
        <ArrowRight className="la-arrow h-6 w-6 shrink-0" strokeWidth={3} />
        <DotText text={CODE[t.platform] ?? "GO"} />
      </div>
      <div className="relative mt-3 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-tight">Your video</p>
          <p className="mt-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60" title={name}>
            {name}
          </p>
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-semibold leading-tight">{meta.name}</h2>
          <p className="mt-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">{meta.format}</p>
        </div>
      </div>

      <div className="la-box relative mt-4 flex min-h-[7.75rem] flex-col justify-center rounded-[1.25rem] p-4 pr-16">
        <p className="text-lg font-semibold leading-tight">{title}</p>
        <p className="mt-1 text-sm leading-snug text-white/65">{statusLine}</p>
        <p className={cn("mt-2 text-[11px] font-bold uppercase tracking-[0.1em]", bad && !canceled ? "text-[#ff8a80]" : "text-[hsl(var(--lime))]")}>{accent}</p>
        <span className="absolute right-3 top-3">
          {live && t.url ? (
            <a href={t.url} target="_blank" rel="noopener noreferrer" className="la-round" aria-label={`See it on ${meta.name} (opens in a new tab)`}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : bad && h?.kind !== "reconnect" ? (
            <button type="button" onClick={onRetry} disabled={busy} className="la-round" aria-label={`${canceled ? "Send it again" : (h?.action ?? "Try again")} on ${meta.name}`}>
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden="true" />
            </button>
          ) : (
            <span className="grid h-11 w-11 place-items-center" aria-hidden="true">
              <PlatformOrb platform={t.platform} size={32} className={cn(t.status === "pending" && "opacity-60")} />
            </span>
          )}
        </span>
      </div>

      {/* The track. The rocket rides the end of the fill; text carries the state, colour backs it up. */}
      <div
        className={cn("la-track relative mt-4 h-14 rounded-full", canceled && "la-off")}
        role="progressbar"
        aria-label={`${meta.name} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${meta.name}: ${canceled ? "stopped by you" : bad ? "stopped, needs a hand" : `${STEPS[step]}, step ${step + 1} of 4`}`}
      >
        <div className={cn("la-fill absolute inset-y-0 left-0 rounded-full", isActive && !reduce && "la-fill-anim")} style={{ width: `max(3.5rem, ${pct}%)` }}>
          <span className="absolute right-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center">
            <OutlyMark variant="ink" size={26} className={cn("la-rocket", isActive && !reduce && "la-rocket-anim")} />
          </span>
          {live && <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-[0.12em] text-[hsl(var(--lime-foreground))]">Landed</span>}
        </div>
        {!live && <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs font-semibold tabular-nums text-white/60">{bad ? "STOPPED" : `${pct}%`}</span>}
      </div>

      {(canStop || h?.kind === "reconnect" || (bad && !canceled)) && (
        <div className="relative mt-4 space-y-1">
          {canStop && (
            <button type="button" onClick={onStop} disabled={busy} className="la-pill la-pill-ghost">
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> {busy ? "Stopping" : "Stop this upload"}
              <span className="sr-only">to {meta.name}</span>
            </button>
          )}
          {h?.kind === "reconnect" && (
            <div className="flex flex-wrap gap-2">
              <a href={`/api/accounts/${t.platform}/connect?returnTo=${returnTo}`} className="la-pill">
                <Link2 className="h-4 w-4" aria-hidden="true" /> {h.action}
              </a>
              <button type="button" onClick={onRetry} disabled={busy} className="la-pill la-pill-ghost">
                Already did? Try again
              </button>
            </div>
          )}
          {bad && !canceled && (
            <details className="group text-xs text-white/65">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1 font-medium hover:text-white">
                Technical details <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" aria-hidden="true" />
              </summary>
              <dl className="space-y-1 rounded-xl bg-white/5 p-3 font-mono text-[11px] leading-relaxed">
                <div>
                  <dt className="inline text-white/75">code: </dt>
                  <dd className="inline">{t.errorCode ?? "UNKNOWN"}</dd>
                </div>
                {t.errorDetail && (
                  <div>
                    <dt className="inline text-white/75">detail: </dt>
                    <dd className="inline break-words">{t.errorDetail}</dd>
                  </div>
                )}
                <div>
                  <dt className="inline text-white/75">attempts: </dt>
                  <dd className="inline">{t.attempts}</dd>
                </div>
              </dl>
            </details>
          )}
        </div>
      )}
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
