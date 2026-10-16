"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, ExternalLink, LayoutGrid, Link2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OutlyMark } from "@/components/brand/Logo";
import { Pip } from "@/components/brand/Pip";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORM_META, TARGET_COPY, type Platform, type TargetStatus } from "@/lib/domain";
import { targetErrorCopy } from "@/components/shared/errorCopy";
import { cn } from "@/lib/utils";
import { DancingPip, MusicToggle, useGroove } from "./Groove";
import type { PostView, TargetView } from "./types";

/**
 * "Sending it out", styled as a Live Activity: one dark slab per destination, a dot-matrix
 * route (YOU -> IG), a status box, and a glowing lime track with the Outlly rocket riding its tip.
 * Pip dances to the groove up top while anything is still moving.
 */
const ACTIVE: TargetStatus[] = ["pending", "queued", "uploading", "processing"];
const STEPS = ["Queued", "Sending", "Processing", "Live"] as const;
const STEP_OF: Record<string, number> = { pending: 0, queued: 0, uploading: 1, processing: 2, published: 3, failed: 3 };
const ROW_COPY: Record<string, string> = {
  pending: "Waiting its turn",
  queued: "Lined up, starting in a moment",
  uploading: "Sending your video",
  processing: "Getting it ready",
  published: "It's live",
  failed: "Needs a hand",
};
const TITLE: Record<string, string> = { pending: "Waiting", queued: "Queued", uploading: "Sending", processing: "Processing", published: "Live", failed: "Stopped" };
const CODE: Record<Platform, string> = { instagram: "IG", youtube: "YT", x: "X", tiktok: "TT", threads: "TH", facebook: "FB", linkedin: "IN" };
/** Each status owns a slice of the track; inside it the fill eases forward so slow platforms still look alive. */
const BAND: Record<string, [number, number, number]> = { pending: [3, 8, 30], queued: [8, 18, 20], uploading: [18, 62, 22], processing: [62, 94, 30] };

export function PublishingView({ initial, onAnother }: { initial: PostView; onAnother: () => void }) {
  const [post, setPost] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const active = post.targets.some((t) => ACTIVE.includes(t.status as TargetStatus));
  const g = useGroove(active);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ post: PostView }>(`/api/posts/${post.id}`);
      setPost(r.post);
    } catch {
      /* transient; next tick tries again */
    }
  }, [post.id]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [active, refresh]);

  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);
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
  const allLive = !active && published.length === post.targets.length;
  const headline = active ? "Sending it out" : allLive ? "You're live." : published.length ? "Almost everywhere." : "Something got in the way.";
  const sub = active
    ? "Each platform moves at its own pace. You can leave this page; we'll keep going."
    : allLive
      ? `Out on ${published.map((t) => PLATFORM_META[t.platform].name).join(" and ")}. Go say hi in the comments.`
      : published.length
        ? `${failed.length === 1 ? "One place needs" : "A couple of places need"} a hand. Everything else is live.`
        : "Nothing went out yet. Here's what happened and how to fix it.";
  const summary = allLive || active ? `${published.length} of ${post.targets.length} live` : `${published.length} live, ${failed.length} to fix`;

  const retry = async (t: TargetView) => {
    setBusy(t.id);
    setErr(null);
    try {
      const r = await api<{ post: PostView }>(`/api/targets/${t.id}/retry`, { method: "POST" });
      setPost(r.post);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something got in the way.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="relative text-center" aria-live="polite">
        <div className="mb-3 flex h-[104px] items-end justify-center">
          {active ? <DancingPip size={92} /> : <Pip size={92} mood={allLive ? "happy" : "sad"} />}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <p className="pub-eyebrow inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em]">
            {active ? <span className={cn("pub-pulse", reduce && "pub-pulse-still")} aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {summary}
            {active && <span className="font-mono tabular-nums normal-case tracking-normal text-muted-foreground">{clock}</span>}
          </p>
          {active && <MusicToggle g={g} />}
        </div>
        <AnimatePresence mode="wait">
          <motion.h2 key={headline} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className={cn("display mt-4 text-[clamp(2.2rem,6vw,3.6rem)]", allLive && "energy-text")}>
            {headline}
            {active && <span className={cn("pub-dots", reduce && "pub-dots-still")} aria-hidden="true"><i /><i /><i /></span>}
          </motion.h2>
        </AnimatePresence>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">{sub}</p>
        {allLive && !reduce && <Burst />}
      </header>

      <ul aria-label="Where your video is going" className="mt-10 flex flex-col gap-5">
        {post.targets.map((t, i) => (
          <LiveActivity key={t.id} t={t} i={i} pct={pctOf(t)} post={post} busy={busy === t.id} onRetry={() => retry(t)} reduce={!!reduce} />
        ))}
      </ul>

      {err && (
        <p role="alert" className="mt-4 text-center text-sm text-destructive">
          {err}
        </p>
      )}

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-8 flex flex-wrap justify-center gap-3">
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

function LiveActivity({ t, i, pct, post, busy, onRetry, reduce }: { t: TargetView; i: number; pct: number; post: PostView; busy: boolean; onRetry: () => void; reduce: boolean }) {
  const meta = PLATFORM_META[t.platform];
  const h = t.status === "failed" ? targetErrorCopy(t.platform, t.errorCode) : null;
  const step = STEP_OF[t.status] ?? 0;
  const isActive = ACTIVE.includes(t.status as TargetStatus);
  const live = t.status === "published";
  const bad = t.status === "failed";
  const returnTo = encodeURIComponent(`/create?post=${post.id}`);
  const name = post.title || post.media.filename || "Untitled";
  const accent = live ? "Live now" : bad ? (h?.kind === "reconnect" ? "Reconnect to finish" : "Tap retry to finish") : `Step ${step + 1} of 4${t.attempts > 1 ? `, try ${t.attempts}` : ""}`;
  const statusLine = h ? h.title : `${meta.name}: ${(ROW_COPY[t.status] ?? TARGET_COPY[t.status as TargetStatus] ?? t.status).toLowerCase()}`;

  return (
    <motion.li
      layout
      initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 28, delay: reduce ? 0 : i * 0.08 }}
      className={cn("la-card relative overflow-hidden rounded-[2.25rem] p-5 text-white sm:p-7", live && "la-live", bad && "la-bad")}
    >
      <span className="la-grid" aria-hidden="true" />
      <div className="relative grid gap-5 md:grid-cols-[1fr_minmax(0,17rem)] md:items-stretch">
        <div className="min-w-0">
          <div className="flex items-center gap-3 sm:gap-5" aria-hidden="true">
            <DotText text="YOU" />
            <ArrowRight className="la-arrow h-7 w-7 shrink-0 sm:h-9 sm:w-9" strokeWidth={3} />
            <DotText text={CODE[t.platform] ?? "GO"} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-tight sm:text-xl">Your video</p>
              <p className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.08em] text-white/55" title={name}>{name}</p>
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-lg font-semibold leading-tight sm:text-xl">
                {meta.name}
              </p>
              <p className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.08em] text-white/55">{meta.format}</p>
            </div>
          </div>
        </div>

        <div className="la-box relative flex min-h-[7.5rem] flex-col justify-center rounded-[1.4rem] p-4 pr-16 sm:p-5 sm:pr-16">
          <p className="text-xl font-semibold leading-tight">{TITLE[t.status] ?? t.status}</p>
          <p className="mt-1 text-sm text-white/60">{statusLine}</p>
          <p className={cn("mt-2 text-xs font-bold uppercase tracking-[0.1em]", bad ? "text-[#ff8a80]" : "text-[hsl(var(--lime))]")}>{accent}</p>
          <span className="absolute right-3 top-3 sm:right-4 sm:top-4">
            {live && t.url ? (
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="la-round" aria-label={`See it on ${meta.name} (opens in a new tab)`}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            ) : bad && h?.kind !== "reconnect" ? (
              <button type="button" onClick={onRetry} disabled={busy} className="la-round" aria-label={`${h?.action ?? "Try again"} on ${meta.name}`}>
                <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden="true" />
              </button>
            ) : (
              <span className="grid h-11 w-11 place-items-center" aria-hidden="true">
                <PlatformOrb platform={t.platform} size={32} className={cn(t.status === "pending" && "opacity-60")} />
              </span>
            )}
          </span>
        </div>
      </div>

      {/* The track. The rocket rides the end of the fill; text carries the state, colour backs it up. */}
      <div
        className="la-track relative mt-5 h-14 rounded-full sm:h-16"
        role="progressbar"
        aria-label={`${meta.name} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${meta.name}: ${bad ? "stopped, needs a hand" : `${STEPS[step]}, step ${step + 1} of 4`}`}
      >
        <div className={cn("la-fill absolute inset-y-0 left-0 rounded-full", isActive && !reduce && "la-fill-anim")} style={{ width: `max(4rem, ${pct}%)` }}>
          <span className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center sm:h-12 sm:w-12">
            <OutlyMark variant="ink" size={30} className={cn("la-rocket", isActive && !reduce && "la-rocket-anim")} />
          </span>
          {live && <span className="absolute left-5 top-1/2 -translate-y-1/2 text-sm font-bold uppercase tracking-[0.12em] text-[hsl(var(--lime-foreground))]">Landed</span>}
        </div>
        {!live && <span className="absolute right-5 top-1/2 -translate-y-1/2 font-mono text-sm font-semibold tabular-nums text-white/55">{bad ? "STOPPED" : `${pct}%`}</span>}
      </div>

      {h && (
        <div className="relative mt-4 space-y-2">
          {h.kind === "reconnect" && (
            <div className="flex flex-wrap gap-2">
              <a href={`/api/accounts/${t.platform}/connect?returnTo=${returnTo}`} className="la-pill">
                <Link2 className="h-4 w-4" aria-hidden="true" /> {h.action}
              </a>
              <button type="button" onClick={onRetry} disabled={busy} className="la-pill la-pill-ghost">
                Already reconnected? Try again
              </button>
            </div>
          )}
          <details className="group text-xs text-white/60">
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
        </div>
      )}
    </motion.li>
  );
}

/* Dot-matrix letters, airport-board style. 5x7 glyphs, each pixel drawn as a 2x2 cluster of dots. */
const GLYPH: Record<string, string[]> = {
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
};
function DotText({ text }: { text: string }) {
  const dots = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    [...text].forEach((ch, ci) => {
      const g = GLYPH[ch];
      if (!g) return;
      g.forEach((row, ry) =>
        [...row].forEach((on, rx) => {
          if (on !== "1") return;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) out.push({ x: ci * 12 + rx * 2 + dx, y: ry * 2 + dy });
        }),
      );
    });
    return out;
  }, [text]);
  const cols = text.length * 12 - 2;
  return (
    <svg className="la-dots h-10 shrink-0 sm:h-14" viewBox={`0 0 ${cols} 14`} style={{ aspectRatio: `${cols} / 14` }}>
      {dots.map((d, k) => (
        <circle key={k} cx={d.x + 0.5} cy={d.y + 0.5} r={0.46} fill="currentColor" />
      ))}
    </svg>
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
