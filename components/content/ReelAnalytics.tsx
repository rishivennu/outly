"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, PanelRight, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Thumb } from "@/components/shared/Thumb";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { fmt, useUser } from "@/components/shell/UserContext";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORM_META, isPlatform } from "@/lib/domain";
import { ago, formatMetric, METRIC_LABEL, METRIC_ORDER, type PostInsights, type TargetInsights } from "@/lib/insights/post-core";
import { cn } from "@/lib/utils";
import type { PostView } from "@/lib/services";

/**
 * 1088: a published post's live numbers, per platform, in a small popup over the Content page.
 * Only what the platform returned is shown as a number; the rest says "Not available", never 0.
 */
export function ReelAnalytics({ post, onClose, onDetails }: { post: PostView | null; onClose: () => void; onDetails: (p: PostView) => void }) {
  const { timezone: tz } = useUser();
  const [data, setData] = useState<(PostInsights & { cached?: boolean; refreshLimited?: boolean }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const seq = useRef(0);

  const load = useCallback(
    async (fresh: boolean) => {
      if (!post) return;
      const my = ++seq.current;
      setBusy(true);
      setErr(null);
      try {
        const r = await api<PostInsights & { cached?: boolean; refreshLimited?: boolean }>(`/api/posts/${post.id}/insights${fresh ? "?fresh=1" : ""}`);
        if (my === seq.current) setData(r); // a slower, older answer never replaces a newer one
      } catch (e) {
        if (my === seq.current) setErr(e instanceof ApiError ? e.message : "We couldn't load the numbers just now.");
      } finally {
        if (my === seq.current) setBusy(false);
      }
    },
    [post],
  );

  useEffect(() => {
    setData(null);
    if (post) void load(false);
  }, [post, load]);

  // Keeps "Updated 2 min ago" honest while the popup stays open.
  useEffect(() => {
    if (!post) return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [post]);

  const caption = post ? (post.targets.find((t) => t.caption?.trim())?.caption ?? post.targets.find((t) => t.description?.trim())?.description ?? null) : null;
  const publishedAt = post?.publishedAt ?? post?.targets.find((t) => t.publishedAt)?.publishedAt ?? null;

  return (
    <Dialog.Root open={!!post} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {post && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[70] bg-foreground/35 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <div className="fixed inset-0 z-[71] grid place-items-center overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6" data-lenis-prevent onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
                <motion.div
                  initial={{ opacity: 0, y: 18, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="glass-strong w-full max-w-[640px] rounded-[28px] p-4 sm:p-6"
                >
                  <div className="flex gap-4">
                    <div className="relative aspect-[9/16] w-[84px] shrink-0 overflow-hidden rounded-2xl hairline sm:w-[104px]">
                      <Thumb src={post.coverUrl ?? post.media.thumbnailUrl} video={null} alt="" className="absolute inset-0" playOnHover={false} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <Dialog.Title className="line-clamp-2 text-lg font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]">{post.title ?? "Untitled"}</Dialog.Title>
                        <Dialog.Close asChild>
                          <button type="button" aria-label="Close analytics" className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                            <X className="h-5 w-5" aria-hidden="true" />
                          </button>
                        </Dialog.Close>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <StatusBadge status={post.status} />
                        {publishedAt && <span>Published {fmt(publishedAt, tz, { month: "short", day: "numeric", year: "numeric" })}</span>}
                        <span className="flex -space-x-1.5">
                          {post.targets.map((t) => (
                            <PlatformOrb key={t.id} platform={t.platform} size={20} ring />
                          ))}
                        </span>
                      </div>
                      {caption && <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-muted-foreground [overflow-wrap:anywhere]">{caption}</p>}
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
                      {busy && !data ? "Fetching the latest numbers…" : data ? (data.refreshLimited ? `Refresh limit reached, try again in a minute. Updated ${ago(data.fetchedAt)}` : `Updated ${ago(data.fetchedAt)}`) : ""}
                    </p>
                    <Button variant="ghost" size="sm" onClick={() => void load(true)} disabled={busy} aria-label="Refresh analytics" className="min-h-[44px]">
                      <RefreshCw className={cn("h-4 w-4", busy && "animate-spin motion-reduce:animate-none")} aria-hidden="true" /> Refresh
                    </Button>
                  </div>

                  <div className="mt-2 space-y-3">
                    {err && !data && (
                      <div role="alert" className="rounded-2xl bg-destructive/10 p-4 text-sm">
                        <p>{err}</p>
                        <Button variant="subtle" size="sm" className="mt-3" onClick={() => void load(false)}>
                          Try again
                        </Button>
                      </div>
                    )}
                    {!data && !err && <Skeleton count={post.targets.length || 1} />}
                    {data?.targets.map((t) => <TargetBlock key={t.targetId} t={t} />)}
                    {data && data.targets.length === 0 && <p className="text-sm text-muted-foreground">This post has no destinations.</p>}
                    {err && data && (
                      <p role="alert" className="text-sm text-destructive">
                        {err}
                      </p>
                    )}
                  </div>

                  <div className="mt-5 flex flex-wrap-reverse gap-2">
                    <Dialog.Close asChild>
                      <Button variant="ghost" className="min-w-[8rem] flex-1">
                        Close
                      </Button>
                    </Dialog.Close>
                    <Button variant="subtle" className="min-w-[8rem] flex-1" onClick={() => onDetails(post)}>
                      <PanelRight className="h-4 w-4" aria-hidden="true" /> Details and actions
                    </Button>
                  </div>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function TargetBlock({ t }: { t: TargetInsights }) {
  const name = isPlatform(t.platform) ? PLATFORM_META[t.platform].name : t.platform;
  const shown = METRIC_ORDER.filter((k) => t.metrics[k] !== undefined);
  // Only metrics this platform can give at all are listed as missing; the rest it never offers.
  const missing = METRIC_ORDER.filter((k) => t.metrics[k] === undefined && (t.supported ?? []).includes(k));
  return (
    <section aria-label={`${name} analytics`} className="rounded-[22px] bg-secondary/40 p-4 hairline">
      <header className="flex items-center gap-2">
        {isPlatform(t.platform) && <PlatformOrb platform={t.platform} size={24} />}
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {name}
          {t.accountName ? <span className="font-normal text-muted-foreground"> · {t.accountName}</span> : null}
        </p>
        {/* Says when the numbers came from the platform, never "live": a cached answer can be up to 2 minutes old. */}
        {t.status === "live" && (
          <span className="rounded-full bg-lime/20 px-2 py-0.5 text-[11px] font-medium" title={`Numbers from ${name}'s API`}>
            {t.fetchedAt ? `Fetched ${ago(t.fetchedAt)}` : `From ${name}`}
          </span>
        )}
        {t.url && /^https:\/\//i.test(t.url) && (
          <a href={t.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-secondary">
            Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
      </header>
      {t.status !== "live" ? (
        <p className={cn("mt-2 text-sm", t.status === "error" ? "text-destructive" : "text-muted-foreground")}>{t.message}</p>
      ) : (
        <>
          {shown.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{name} returned no numbers for this post yet.</p>
          ) : (
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {shown.map((k) => (
                <div key={k} className="rounded-2xl bg-card/70 px-3 py-2.5 hairline">
                  <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{METRIC_LABEL[k]}</dt>
                  <dd className="tabular mt-0.5 text-lg font-semibold">{formatMetric(k, t.metrics[k]!)}</dd>
                </div>
              ))}
            </dl>
          )}
          {missing.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Not available for this post: {missing.map((k) => METRIC_LABEL[k].toLowerCase()).join(", ")}.</p>}
          {t.notes.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11.5px] text-muted-foreground">
              {t.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Skeleton({ count }: { count: number }) {
  return (
    <div aria-hidden="true" className="space-y-3">
      {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
        <div key={i} className="rounded-[22px] bg-secondary/40 p-4 hairline">
          <div className="h-4 w-32 animate-pulse rounded-full bg-foreground/10 motion-reduce:animate-none" />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((__, j) => (
              <div key={j} className="h-[58px] animate-pulse rounded-2xl bg-foreground/[0.07] motion-reduce:animate-none" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
