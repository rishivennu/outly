"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, ExternalLink, Image as ImageIcon, Play, RotateCcw, VolumeX, X } from "lucide-react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META } from "@/lib/domain";
import { aspectOf, relatedComments, type CommentMedia } from "@/lib/inbox-media";
import type { InboxComment } from "@/lib/inbox";
import { cn } from "@/lib/utils";

/** Can this comment open a preview at all? */
export const hasPreview = (c: InboxComment) => !!c.media && !!(c.media.thumbnailUrl || c.media.videoUrl || c.media.embedUrl);

/** 9:16 tile on the left of a comment card. Falls back to the platform mark when there is nothing to show. */
export function PreviewTile({ comment, id, onOpen }: { comment: InboxComment; id: string; onOpen: () => void }) {
  const m = comment.media;
  const [broken, setBroken] = useState(false);
  if (!m || !hasPreview(comment)) return <PlatformOrb platform={comment.platform} size={30} />;
  const name = comment.postTitle ?? "this post";
  return (
    <button
      type="button"
      id={id}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`Preview ${m.kind === "image" ? "the photo" : "the video"}: ${name}`}
      className="group relative aspect-[9/16] w-[52px] shrink-0 overflow-hidden rounded-xl bg-secondary hairline transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-16"
    >
      {m.thumbnailUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
      ) : (
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-secondary to-muted" />
      )}
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/0 transition group-hover:bg-black/15">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
          {m.kind === "image" ? <ImageIcon className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />}
        </span>
      </span>
      <span aria-hidden="true" className="absolute bottom-1 right-1">
        <PlatformOrb platform={comment.platform} size={16} />
      </span>
    </button>
  );
}

/** Nearest element that actually scrolls, so closing the preview puts the list back exactly where it was. */
function scrollParent(el: HTMLElement | null): HTMLElement {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

type Open = { comment: InboxComment; from: string };

/** Lifted state for the inbox: which comment is previewed, and how to get back to it. */
export function usePreview() {
  const [open, setOpen] = useState<Open | null>(null);
  const back = useRef<{ el: HTMLElement; top: number; from: string } | null>(null);
  const show = (comment: InboxComment, from: string) => {
    const btn = document.getElementById(from);
    const sc = scrollParent(btn);
    back.current = { el: sc, top: sc.scrollTop, from };
    setOpen({ comment, from });
  };
  const restore = () => {
    const b = back.current;
    if (!b) return;
    b.el.scrollTop = b.top;
    document.getElementById(b.from)?.focus({ preventScroll: true });
    back.current = null;
  };
  return { open, show, select: (comment: InboxComment) => setOpen((o) => (o ? { ...o, comment } : o)), close: () => setOpen(null), restore };
}

const fmtWhen = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/**
 * The reel beside its comments, without leaving the inbox (1052). Radix gives the focus trap, Escape and aria-modal;
 * a click on the backdrop closes it too. Phones get the whole screen, with the close button over the video.
 */
export function VideoPreview({ state, all, onSelect, onClose, onClosed }: { state: Open | null; all: InboxComment[]; onSelect: (c: InboxComment) => void; onClose: () => void; onClosed: () => void }) {
  const reduce = useReducedMotion();
  // The live copy, so a reply sent from the list shows up here too.
  const found = state ? all.find((c) => c.id === state.comment.id && c.targetId === state.comment.targetId) : undefined;
  const comment = state ? found ?? state.comment : null;
  // A reload (platform filter, refresh) that drops this comment closes the preview instead of showing a stale one.
  const gone = !!state && !found;
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const thread = useMemo(() => (comment ? relatedComments(all, comment) : []), [all, comment]);
  const meta = comment ? PLATFORM_META[comment.platform] : null;
  const player = useRef<HTMLDivElement>(null);

  // Stop playback the moment it starts closing; the exit animation shouldn't keep talking.
  const close = () => {
    player.current?.querySelectorAll("video").forEach((v) => v.pause());
    onClose();
  };
  useEffect(() => {
    if (!gone) return;
    player.current?.querySelectorAll("video").forEach((v) => v.pause());
    onCloseRef.current();
  }, [gone]);

  return (
    <Dialog.Root open={!!comment} onOpenChange={(o) => !o && close()}>
      <AnimatePresence onExitComplete={onClosed}>
        {comment && meta && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[70] bg-foreground/45 backdrop-blur-[4px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              aria-describedby={undefined}
              onCloseAutoFocus={(e) => e.preventDefault()}
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                // Two close buttons (over the video on phones, in the header on desktop); focus the one on screen.
                Array.from(document.querySelectorAll<HTMLElement>("[data-preview-close]")).find((b) => b.offsetParent !== null)?.focus({ preventScroll: true });
              }}
            >
              <div className="fixed inset-0 z-[71] grid place-items-center md:p-6" onPointerDown={(e) => e.target === e.currentTarget && close()}>
                <motion.div
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
                  transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 38 }}
                  className="relative flex h-dvh w-full flex-col overflow-hidden bg-background md:h-auto md:max-h-[min(90dvh,860px)] md:w-auto md:max-w-[min(1120px,calc(100vw-3rem))] md:flex-row md:rounded-[28px] md:shadow-2xl md:hairline"
                >
                  <div ref={player} className="relative flex shrink-0 items-center justify-center bg-black md:self-stretch">
                    {/* key: a different reel remounts the player, which stops whatever was playing */}
                    <Player key={comment.targetId} media={comment.media ?? null} title={comment.postTitle ?? "Post"} platformName={meta.name} postUrl={comment.postUrl} />
                    <Dialog.Close asChild>
                      <button
                        data-preview-close
                        type="button"
                        aria-label="Close preview"
                        className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 grid h-11 w-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md transition hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:hidden"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </Dialog.Close>
                  </div>

                  <section className="flex min-h-0 flex-1 flex-col md:w-[380px] md:flex-none" aria-label="Post and comments">
                    <header className="flex items-start gap-3 border-b border-foreground/10 p-4 md:p-5">
                      <PlatformOrb platform={comment.platform} size={32} />
                      <div className="min-w-0 flex-1">
                        <Dialog.Title className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]">{comment.postTitle ?? `A ${meta.name} post`}</Dialog.Title>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {[comment.media?.account, fmtWhen(comment.media?.postedAt)].filter(Boolean).join(" · ") || meta.name}
                        </p>
                      </div>
                      <Dialog.Close asChild>
                        <button type="button" data-preview-close aria-label="Close preview" className="hidden h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring md:grid">
                          <X className="h-5 w-5" />
                        </button>
                      </Dialog.Close>
                    </header>

                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-5" data-lenis-prevent>
                      {comment.media?.caption && <Caption text={comment.media.caption} />}
                      {comment.postUrl && (
                        <a href={comment.postUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-sm font-medium hairline transition hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                          Open on {meta.name} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      )}

                      <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {thread.length === 1 ? "The comment" : `${thread.length} comments on this post`}
                      </h3>
                      <ul className="mt-2 space-y-1.5">
                        {thread.map((c) => (
                          <ThreadItem key={c.id} c={c} selected={c.id === comment.id} onPick={() => onSelect(c)} />
                        ))}
                      </ul>
                    </div>
                  </section>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function Caption({ text }: { text: string }) {
  const [more, setMore] = useState(false);
  const long = text.length > 220 || text.split("\n").length > 4;
  return (
    <div>
      <p className={cn("whitespace-pre-wrap text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]", !more && long && "line-clamp-4")}>{text}</p>
      {long && (
        <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="mt-1 min-h-[44px] text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          {more ? "Show less" : "Read the full caption"}
        </button>
      )}
    </div>
  );
}

function ThreadItem({ c, selected, onPick }: { c: InboxComment; selected: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  // Bring the comment the person clicked into view inside the panel, not the page behind it.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const replies = c.replies ?? [];
  return (
    <li>
      <button
        ref={ref}
        type="button"
        onClick={onPick}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "w-full rounded-2xl px-3.5 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          selected ? "bg-lime/15 ring-1 ring-lime/50" : "hover:bg-secondary/70",
        )}
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium">
          {c.authorName}
          {selected && <span className="rounded-full bg-lime/30 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-lime-ink dark:text-lime">Selected</span>}
          <span className="text-xs font-normal text-muted-foreground">{fmtWhen(c.createdAt)}</span>
        </span>
        <span className={cn("mt-1 block whitespace-pre-wrap text-sm [overflow-wrap:anywhere]", !selected && "line-clamp-3")}>{c.text}</span>
        {!selected && replies.length > 0 && <span className="mt-1 block text-xs text-muted-foreground">{replies.length === 1 ? "1 reply" : `${replies.length} replies`}</span>}
      </button>
      {selected && replies.length > 0 && (
        <ul className="ml-4 mt-1.5 space-y-1.5 border-l-2 border-foreground/10 pl-3">
          {replies.map((r) => (
            <li key={r.id} className="text-sm [overflow-wrap:anywhere]">
              <span className="font-medium">{r.authorName}</span> <span className="whitespace-pre-wrap">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

type Mode = "file" | "embed" | "image" | "none";
const firstMode = (m: CommentMedia | null): Mode => (!m ? "none" : m.kind === "image" ? (m.thumbnailUrl ? "image" : "none") : m.videoUrl ? "file" : m.embedUrl ? "embed" : "none");

/**
 * Plays the post at its own shape. Starts muted when it starts at all (never with sound, never under reduced motion);
 * the poster stays up with a spinner until the first frame, and a dead link becomes a message, not a broken box.
 */
function Player({ media, title, platformName, postUrl }: { media: CommentMedia | null; title: string; platformName: string; postUrl: string | null }) {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<Mode>(() => firstMode(media));
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [muted, setMuted] = useState(true);
  const [tries, setTries] = useState(0);
  const [natural, setNatural] = useState<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  const ar = natural ?? aspectOf(media, mode === "embed" ? 16 / 9 : 9 / 16);
  const tall = ar < 1;
  const poster = media?.thumbnailUrl ?? undefined;

  const fail = () => {
    // Our own file is gone or expired: YouTube's player still has the video.
    if (mode === "file" && media?.embedUrl) {
      setMode("embed");
      setReady(false);
      return;
    }
    setFailed(true);
  };

  const retry = () => {
    setFailed(false);
    setReady(false);
    setMode(firstMode(media));
    setTries((n) => n + 1);
  };

  // Phones: the top of the screen. Desktop: the video's own shape, leaving 380px for the comments beside it.
  const box = cn(
    "relative w-full overflow-hidden bg-black md:max-w-[calc(100vw-3rem-380px)]",
    tall ? "h-[min(62dvh,calc(100vw*16/9))] md:h-[min(84dvh,780px)] md:w-auto md:aspect-[var(--ar)]" : "aspect-[var(--ar)] md:w-[min(calc(100vw-3rem-380px),720px)]",
  );

  return (
    <div className={box} style={{ ["--ar" as string]: String(ar) }}>
      <div className="h-full">
        {/* poster under everything: the loading state, and what stays when the video can't play */}
        {poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" referrerPolicy="no-referrer" className={cn("absolute inset-0 h-full w-full object-contain transition-opacity duration-300", ready && mode !== "image" && "opacity-0")} />
        )}

        {mode === "file" && media?.videoUrl && !failed && (
          <video
            key={tries}
            ref={video}
            src={media.videoUrl}
            poster={poster}
            controls
            playsInline
            muted={muted}
            autoPlay={!reduce}
            preload="metadata"
            controlsList="nodownload"
            aria-label={`${title}, ${platformName} video`}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) setNatural(v.videoWidth / v.videoHeight);
            }}
            onLoadedData={() => setReady(true)}
            onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
            onError={fail}
            className={cn("absolute inset-0 h-full w-full object-contain transition-opacity duration-300", ready ? "opacity-100" : "opacity-0")}
          />
        )}

        {mode === "embed" && media?.embedUrl && !failed && (
          <iframe
            key={tries}
            src={media.embedUrl}
            title={`${title}, ${platformName} player`}
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => setReady(true)}
            className={cn("absolute inset-0 h-full w-full border-0 transition-opacity duration-300", ready ? "opacity-100" : "opacity-0")}
          />
        )}

        {mode === "image" && media?.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.thumbnailUrl} alt={title} referrerPolicy="no-referrer" onLoad={() => setReady(true)} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-contain" />
        )}

        {!ready && !failed && mode !== "none" && (
          <div role="status" aria-label="Loading the video" className="absolute inset-0 grid place-items-center bg-black/25">
            <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/30 border-t-white motion-reduce:animate-none motion-reduce:border-t-white/80" aria-hidden="true" />
          </div>
        )}

        {(failed || mode === "none") && (
          <div role="alert" className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center text-white">
            <div className="max-w-[260px]">
              <AlertCircle className="mx-auto h-7 w-7 text-white/85" aria-hidden="true" />
              <p className="mt-2 font-medium">{media?.kind === "image" ? "This photo can't load here" : "This video can't play here"}</p>
              <p className="mt-1 text-sm text-white/80">{platformName} didn&apos;t hand us a playable copy. It may be private, removed, or the link expired. The comments still work.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {mode !== "none" && (
                  <button type="button" onClick={retry} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm font-medium transition hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                    <RotateCcw className="h-4 w-4" aria-hidden="true" /> Try again
                  </button>
                )}
                {postUrl && (
                  <a href={postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-white px-4 text-sm font-medium text-black transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                    Open on {platformName} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Sound is off until asked for. One big target, because the native mute button is tiny on phones. */}
        {mode === "file" && ready && !failed && muted && (
          <button
            type="button"
            onClick={() => {
              const v = video.current;
              if (!v) return;
              v.muted = false;
              if (v.paused) v.play().catch(() => {});
            }}
            className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-black/55 px-3.5 text-sm font-medium text-white backdrop-blur-md transition hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <VolumeX className="h-4 w-4" aria-hidden="true" /> Tap for sound
          </button>
        )}
      </div>
    </div>
  );
}
