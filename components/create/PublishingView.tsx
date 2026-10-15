"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Check, ChevronDown, ExternalLink, LayoutGrid, Link2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D, type IconName } from "@/components/brand/Icon3D";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PlatformOrb, PLATFORM_HALO } from "@/components/shared/PlatformIcon";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORM_META, TARGET_COPY, type TargetStatus } from "@/lib/domain";
import { targetErrorCopy } from "@/components/shared/errorCopy";
import { cn } from "@/lib/utils";
import { PostingAnimation } from "./PostingAnimation";
import type { PostView, TargetView } from "./types";

const ACTIVE: TargetStatus[] = ["pending", "queued", "uploading", "processing"];
const PROGRESS: Record<string, number> = { pending: 0.04, queued: 0.12, uploading: 0.45, processing: 0.78, published: 1, failed: 1 };
const W = 640;
const H = 400;

export function PublishingView({ initial, onAnother }: { initial: PostView; onAnother: () => void }) {
  const [post, setPost] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const active = post.targets.some((t) => ACTIVE.includes(t.status as TargetStatus));

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

  const published = post.targets.filter((t) => t.status === "published");
  const failed = post.targets.filter((t) => t.status === "failed");
  const allLive = !active && published.length === post.targets.length;
  const needsReconnect = failed.some((t) => t.errorCode === "AUTH_EXPIRED" || t.errorCode === "NOT_CONNECTED");
  const headline = active ? "Sending it out…" : allLive ? "You're live." : published.length ? "Almost everywhere." : "Something got in the way.";
  /** Friendly 3D marker for the moment; the per-destination badges carry the real state. */
  const hero: IconName = active
    ? post.targets.some((t) => t.status === "processing" || t.status === "uploading")
      ? "processing"
      : "loading"
    : allLive
      ? "celebration"
      : needsReconnect
        ? "reconnect"
        : "error";
  const sub = active
    ? "Hang tight. Each place moves at its own pace."
    : allLive
      ? `Out on ${published.map((t) => PLATFORM_META[t.platform].name).join(", ")}. Go say hi in the comments.`
      : published.length
        ? `${failed.length === 1 ? "One place needs" : "A couple of places need"} a hand. Everything else is live.`
        : "Nothing went out yet. Here's what happened and how to fix it.";

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

  const nodes = useMemo(() => {
    const n = post.targets.length;
    return post.targets.map((t, i) => ({ t, x: 540, y: n === 1 ? H / 2 : 70 + (i * (H - 140)) / (n - 1) }));
  }, [post.targets]);
  const origin = { x: 110, y: H / 2 };
  const path = (y: number) => `M ${origin.x + 46} ${origin.y} C ${330} ${origin.y}, ${330} ${y}, ${540 - 34} ${y}`;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="text-center" aria-live="polite">
        {active ? (
          <PostingAnimation platforms={post.targets.filter((t) => ACTIVE.includes(t.status as TargetStatus)).map((t) => t.platform)} />
        ) : (
        <div className="mb-5 flex justify-center">
          <AnimatePresence mode="wait">
            <motion.span key={hero} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ type: "spring", stiffness: 320, damping: 24 }} className="inline-block">
              <span className={cn("block", active && !reduce && "animate-bob")}>
                <Icon3D name={hero} size={96} priority />
              </span>
            </motion.span>
          </AnimatePresence>
        </div>
        )}
        <AnimatePresence mode="wait">
          <motion.h2 key={headline} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className={cn("display text-[clamp(2.4rem,7vw,4.6rem)]", allLive && "energy-text")}>
            {headline}
          </motion.h2>
        </AnimatePresence>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">{sub}</p>
      </div>

      {/* The journey, drawn: one video, many destinations. Decorative; the cards below carry the same information. */}
      <div className="relative mx-auto mt-8 aspect-[16/10] w-full max-w-2xl" aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible">
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {nodes.map(({ t, y }) => {
            const d = path(y);
            const color = t.status === "failed" ? "hsl(var(--destructive))" : t.status === "published" ? "hsl(var(--success))" : PLATFORM_HALO[t.platform];
            const moving = ACTIVE.includes(t.status as TargetStatus) && t.status !== "pending";
            return (
              <g key={t.id}>
                <path d={d} fill="none" stroke="hsl(var(--foreground) / 0.08)" strokeWidth={2} />
                <motion.path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={t.status === "failed" ? "4 8" : undefined} initial={{ pathLength: 0 }} animate={{ pathLength: PROGRESS[t.status] ?? 0 }} transition={{ duration: reduce ? 0 : 0.9, ease: [0.22, 1, 0.36, 1] }} filter={t.status === "published" ? "url(#glow)" : undefined} />
                {moving && !reduce && (
                  <circle r={4.5} fill={color} filter="url(#glow)">
                    <animateMotion dur={t.platform === "x" ? "1.1s" : "1.6s"} repeatCount="indefinite" path={d} />
                  </circle>
                )}
              </g>
            );
          })}
        </svg>

        <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${(origin.x / W) * 100}%`, top: `${(origin.y / H) * 100}%` }}>
          <motion.div animate={active && !reduce ? { scale: [1, 1.04, 1] } : {}} transition={{ duration: 1.6, repeat: Infinity }} className="relative aspect-[9/16] w-[clamp(52px,13vw,84px)] overflow-hidden rounded-2xl bg-secondary shadow-[0_20px_60px_-20px_hsl(var(--lime)/0.6)] hairline">
            {post.media.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.media.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            )}
          </motion.div>
        </div>

        {nodes.map(({ t, x, y }) => (
          <div key={t.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}>
            <div className="relative">
              {ACTIVE.includes(t.status as TargetStatus) && !reduce && <motion.span className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${PLATFORM_HALO[t.platform]}` }} animate={{ scale: [1, 1.6], opacity: [0.7, 0] }} transition={{ duration: 1.4, repeat: Infinity }} />}
              <PlatformOrb platform={t.platform} size={56} className={cn("transition", t.status === "pending" && "opacity-50")} />
              <AnimatePresence>
                {(t.status === "published" || t.status === "failed") && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }} className={cn("absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border-2 border-background", t.status === "published" ? "bg-success text-[hsl(var(--lime-foreground))]" : "bg-destructive text-destructive-foreground")}>
                    {t.status === "published" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <span className="text-xs font-bold">!</span>}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
        ))}

        {allLive && !reduce && <Burst />}
      </div>

      <ul className="mt-6 grid gap-3 sm:grid-cols-3">
        {post.targets.map((t) => (
          <TargetCard key={t.id} t={t} postId={post.id} busy={busy === t.id} onRetry={() => retry(t)} />
        ))}
      </ul>
      {err && (
        <p role="alert" className="mt-4 text-center text-sm text-destructive">
          {err}
        </p>
      )}

      {!active && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild variant="primary" size="lg">
            <Link href="/content">
              <LayoutGrid className="h-5 w-5" /> See your content
            </Link>
          </Button>
          <Button variant="subtle" size="lg" onClick={onAnother}>
            <Plus className="h-5 w-5" /> Create another
          </Button>
        </motion.div>
      )}
    </div>
  );
}

function TargetCard({ t, postId, busy, onRetry }: { t: TargetView; postId: string; busy: boolean; onRetry: () => void }) {
  const meta = PLATFORM_META[t.platform];
  const h = t.status === "failed" ? targetErrorCopy(t.platform, t.errorCode) : null;
  const pct = Math.round((PROGRESS[t.status] ?? 0) * 100);
  const returnTo = encodeURIComponent(`/create?post=${postId}`);
  return (
    <motion.li layout className={cn("flex flex-col rounded-3xl bg-card p-4 hairline", t.status === "failed" && "ring-1 ring-destructive/40")}>
      <div className="flex items-center gap-3">
        <PlatformOrb platform={t.platform} size={32} />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">
              {meta.name} <span className="font-normal text-muted-foreground">{meta.format}</span>
            </span>
          </p>
          <p className={cn("text-xs", t.status === "published" ? "text-success" : t.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
            {t.status === "published" ? "It's live." : TARGET_COPY[t.status as TargetStatus] ?? t.status}
            {t.attempts > 1 && ACTIVE.includes(t.status as TargetStatus) ? ` · try ${t.attempts}` : ""}
          </p>
        </div>
        {/* The warm line above never replaces the real state. */}
        <StatusBadge status={h?.kind === "reconnect" ? "needs_reconnect" : t.status} className="ml-auto shrink-0" />
      </div>

      {t.status !== "failed" && (
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`${meta.name} progress`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <motion.div className={cn("h-full rounded-full", t.status === "published" ? "bg-success" : "lime-bg")} animate={{ width: `${pct}%` }} transition={{ ease: "easeOut", duration: 0.6 }} />
        </div>
      )}

      {t.status === "published" && (t.url ? (
        <a href={t.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium hover:underline">
          See it on {meta.name} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Posted.</p>
      ))}

      {h && (
        <div className="mt-3 space-y-3">
          <p className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            {h.title}
          </p>
          {h.kind === "reconnect" ? (
            <Button asChild size="sm" variant="primary" className="w-full">
              <a href={`/api/accounts/${t.platform}/connect?returnTo=${returnTo}`}>
                <Link2 className="h-4 w-4" /> {h.action}
              </a>
            </Button>
          ) : (
            <Button size="sm" variant="primary" className="w-full" onClick={onRetry} disabled={busy}>
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} /> {h.action}
            </Button>
          )}
          {h.kind === "reconnect" && (
            <Button size="sm" variant="ghost" className="w-full" onClick={onRetry} disabled={busy}>
              Already reconnected? Let&apos;s try again
            </Button>
          )}
          <details className="group text-xs text-muted-foreground">
            <summary className="flex min-h-[36px] list-none items-center gap-1 font-medium hover:text-foreground">
              Technical details <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <dl className="mt-1 space-y-1 rounded-xl bg-secondary/60 p-3 font-mono text-[11px] leading-relaxed">
              <div>
                <dt className="inline text-foreground/70">code: </dt>
                <dd className="inline">{t.errorCode ?? "UNKNOWN"}</dd>
              </div>
              {t.errorDetail && (
                <div>
                  <dt className="inline text-foreground/70">detail: </dt>
                  <dd className="inline break-words">{t.errorDetail}</dd>
                </div>
              )}
              <div>
                <dt className="inline text-foreground/70">attempts: </dt>
                <dd className="inline">{t.attempts}</dd>
              </div>
            </dl>
          </details>
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
    <div className="pointer-events-none absolute left-1/2 top-1/2">
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
