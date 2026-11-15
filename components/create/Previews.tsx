"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { BarChart2, Bookmark, Camera, Heart, MessageCircle, MoreHorizontal, Music2, Pause, Play, Repeat2, Search, Send, Share, ThumbsDown, ThumbsUp, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import type { Draft } from "./types";
import { FIRST_FRAME, needsFirstFrame, playback, usePlayback } from "./player-state";

export interface PreviewProps {
  draft: Draft;
  src: string | null;
  poster: string | null;
  handle: string;
  name: string;
  avatar?: string | null;
  /** The video's own width / height. Feed cards keep it; full screen formats keep the phone frame. */
  aspect?: number;
  /** Poster until the person presses play, with real controls. Off: a muted ambient loop (the Preview sheet). */
  interactive?: boolean;
  className?: string;
}

function Rich({ text, tagClass }: { text: string; tagClass: string }) {
  return (
    <>
      {text.split(/(#[\p{L}\p{N}_]+|@[\w.]+)/u).map((part, i) =>
        /^[#@]/.test(part) ? (
          <span key={i} className={tagClass}>
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * A muted loop of the creator's video. It never competes with the editor's player: it plays only while on
 * screen and while that player is paused, and holds still (first frame) for reduced motion.
 */
function LoopVideo({ src, poster, className }: { src: string; poster: string | null; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  usePlayback(ref, "ambient", src);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let seen = false;
    const sync = () => {
      if (still || !seen || playback.mainPlaying()) v.pause();
      else v.play().catch(() => {});
    };
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([e]) => ((seen = e.isIntersecting), sync()), { threshold: 0.4 });
    if (io) io.observe(v);
    else {
      seen = true;
      sync();
    }
    const off = playback.subscribe(sync);
    return () => {
      io?.disconnect();
      off();
    };
  }, [src]);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster ?? undefined}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
      onLoadedMetadata={(e) => needsFirstFrame(e.currentTarget, !!poster) && (e.currentTarget.currentTime = FIRST_FRAME)}
      className={cn("h-full w-full bg-black object-contain", className)}
    />
  );
}

type Clip = { ref: RefObject<HTMLVideoElement | null>; playing: boolean; muted: boolean; toggle: () => void; toggleMute: () => void };

/**
 * The deck's preview player: it shows the poster (or first frame) until play is pressed, then plays with sound
 * as the page's one main player, so any other video pauses. Nothing starts on its own.
 */
function useClip(src: string | null): Clip {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  usePlayback(ref, "main", src);
  useEffect(() => {
    const v = ref.current;
    setPlaying(false);
    if (!v) return;
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    v.addEventListener("play", on);
    v.addEventListener("pause", off);
    v.addEventListener("ended", off);
    return () => {
      v.removeEventListener("play", on);
      v.removeEventListener("pause", off);
      v.removeEventListener("ended", off);
    };
  }, [src]);
  return {
    ref,
    playing,
    muted,
    toggle: () => {
      const v = ref.current;
      if (!v) return;
      if (v.paused) void v.play()?.catch(() => setPlaying(false));
      else v.pause();
    },
    toggleMute: () => {
      const v = ref.current;
      if (!v) return;
      v.muted = !v.muted;
      setMuted(v.muted);
    },
  };
}

const CTL = "grid h-11 w-11 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-[background-color,transform] duration-press ease-out active:scale-[0.96] motion-reduce:transition-none [@media(hover:hover)]:hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

function ClipControls({ clip, label, className }: { clip: Clip; label: string; className?: string }) {
  return (
    <>
      {!clip.playing && (
        <button type="button" onClick={clip.toggle} aria-label={`Play ${label}`} className={cn(CTL, "absolute left-1/2 top-1/2 z-10 h-14 w-14 -translate-x-1/2 -translate-y-1/2 active:scale-[0.96]")}>
          <Play className="h-6 w-6 translate-x-[1px] fill-current" aria-hidden="true" />
        </button>
      )}
      <div className={cn("absolute z-10 flex gap-1.5", className)}>
        {clip.playing && (
          <button type="button" onClick={clip.toggle} aria-label={`Pause ${label}`} className={CTL}>
            <Pause className="h-5 w-5 fill-current" aria-hidden="true" />
          </button>
        )}
        <button type="button" onClick={clip.toggleMute} aria-label={clip.muted ? "Unmute" : "Mute"} aria-pressed={clip.muted} className={CTL}>
          {clip.muted ? <VolumeX className="h-5 w-5" aria-hidden="true" /> : <Volume2 className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>
    </>
  );
}

function Media({ src, poster, className, clip }: { src: string | null; poster: string | null; className?: string; clip?: Clip | null }) {
  if (src && clip)
    return (
      <video
        ref={clip.ref}
        src={src}
        poster={poster ?? undefined}
        playsInline
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
        onClick={clip.toggle}
        onLoadedMetadata={(e) => needsFirstFrame(e.currentTarget, !!poster) && (e.currentTarget.currentTime = FIRST_FRAME)}
        className={cn("h-full w-full bg-black object-contain", className)}
      />
    );
  if (src) return <LoopVideo src={src} poster={poster} className={className} />;
  if (poster)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={poster} alt="" className={cn("h-full w-full object-cover", className)} />;
  return <div className={cn("h-full w-full bg-gradient-to-br from-secondary to-background", className)} />;
}

/** A feed card's media box at the video's own shape, never taller than the card can show. */
function FeedMedia({ src, poster, aspect, clip, label, className }: { src: string | null; poster: string | null; aspect?: number; clip: Clip | null; label: string; className?: string }) {
  const a = aspect ?? 4 / 5;
  return (
    <div className={cn("relative mx-auto max-w-full overflow-hidden", className)} style={{ aspectRatio: String(a), width: `min(100%, ${Math.round(440 * a)}px)` }}>
      <Media src={src} poster={poster} clip={clip} />
      {clip && src && <ClipControls clip={clip} label={label} className="bottom-2 left-2" />}
    </div>
  );
}

function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={cn("rounded-full object-cover", className)} />
  ) : (
    <span className={cn("grid place-items-center rounded-full energy-bg text-xs font-bold text-black", className)} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Rail({ items }: { items: { icon: React.ElementType; label?: string; fill?: boolean }[] }) {
  return (
    <div className="pointer-events-none absolute bottom-24 right-2 flex flex-col items-center gap-4 text-white" aria-hidden="true">
      {items.map(({ icon: I, label, fill }, i) => (
        <span key={i} className="flex flex-col items-center gap-0.5 drop-shadow">
          <I className={cn("h-6 w-6", fill && "fill-current")} strokeWidth={1.8} />
          {label && <span className="text-xs font-semibold">{label}</span>}
        </span>
      ))}
    </div>
  );
}

const FRAME = "relative mx-auto aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-[26px] bg-black text-white hairline";

/** Instagram Reel, as it shows in the Reels tab. */
export function InstagramReel({ draft, src, poster, handle, avatar, interactive, className }: PreviewProps) {
  const [more, setMore] = useState(false);
  const clip = useClip(interactive ? src : null);
  const caption = [draft.caption, draft.hashtags].filter(Boolean).join(" ");
  return (
    <div className={cn(FRAME, className)} role="group" aria-label={`Instagram Reel preview. Caption: ${caption || "empty"}`}>
      <Media src={src} poster={poster} clip={interactive ? clip : null} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-3 text-[15px] font-bold" aria-hidden="true">
        Reels <Camera className="h-5 w-5" />
      </div>
      <Rail items={[{ icon: Heart }, { icon: MessageCircle }, { icon: Send }, { icon: MoreHorizontal }]} />
      <div className="absolute inset-x-0 bottom-0 space-y-2 p-3 pr-12">
        <div className="flex items-center gap-2" aria-hidden="true">
          <Avatar name={handle} src={avatar} className="h-7 w-7 ring-1 ring-white/40" />
          <span className="min-w-0 truncate text-[13px] font-semibold">{handle}</span>
          <span className="rounded-lg border border-white/60 px-2 py-0.5 text-xs font-semibold">Follow</span>
        </div>
        <p className={cn("whitespace-pre-line break-words text-[13px] leading-snug", !more && "line-clamp-2")} aria-hidden="true">
          {caption ? <Rich text={caption} tagClass="text-white/95 font-medium" /> : <span className="text-white/60">Your caption shows here</span>}
        </p>
        {caption.length > 80 && (
          <button type="button" onClick={() => setMore((m) => !m)} className="text-[12px] font-medium text-white/75">
            {more ? "less" : "… more"}
          </button>
        )}
        <div className="flex items-center gap-1.5 text-xs text-white/85" aria-hidden="true">
          <Music2 className="h-3 w-3" /> {handle} · Original audio
        </div>
      </div>
      {interactive && src && <ClipControls clip={clip} label="the Instagram preview" className="left-2 top-11" />}
    </div>
  );
}

/** YouTube Short, as it shows in the Shorts player. */
export function YouTubeShort({ draft, src, poster, handle, avatar, interactive, className }: PreviewProps) {
  const clip = useClip(interactive ? src : null);
  return (
    <div className={cn(FRAME, className)} role="group" aria-label={`YouTube Short preview. Title: ${draft.title || "empty"}`}>
      <Media src={src} poster={poster} clip={interactive ? clip : null} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/85" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-end gap-4 px-4 pt-3" aria-hidden="true">
        <Search className="h-5 w-5" />
        <MoreHorizontal className="h-5 w-5 rotate-90" />
      </div>
      <Rail items={[{ icon: ThumbsUp, fill: true }, { icon: ThumbsDown, label: "Dislike", fill: true }, { icon: MessageCircle, fill: true }, { icon: Share, label: "Share" }]} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 space-y-2 p-3 pr-12">
        <p className="line-clamp-2 break-words text-[14px] font-semibold leading-snug" aria-hidden="true">
          {draft.title || <span className="text-white/60">Your title shows here</span>}
        </p>
        <div className="flex items-center gap-2" aria-hidden="true">
          <Avatar name={handle} src={avatar} className="h-7 w-7" />
          <span className="min-w-0 truncate text-[13px] font-medium">@{handle.replace(/^@/, "").replace(/\s+/g, "").toLowerCase()}</span>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-black">Subscribe</span>
        </div>
        {draft.hashtags && <p className="truncate text-xs text-white/80" aria-hidden="true">{draft.hashtags}</p>}
      </div>
      {interactive && src && <ClipControls clip={clip} label="the YouTube preview" className="left-2 top-2" />}
    </div>
  );
}

/** X post, as it shows in the For You timeline. */
export function XPost({ draft, src, poster, handle, name, avatar, aspect, interactive, className }: PreviewProps) {
  const clip = useClip(interactive ? src : null);
  return (
    <article className={cn("mx-auto w-full max-w-[420px] rounded-[22px] bg-black p-4 text-[#e7e9ea] hairline", className)} aria-label={`X post preview: ${draft.caption || "empty"}`}>
      <div className="flex gap-3">
        <Avatar name={name} src={avatar} className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[15px]" aria-hidden="true">
            <span className="truncate font-bold text-white">{name}</span>
            <span className="truncate text-[#71767b]">@{handle.replace(/^@/, "")} · now</span>
            <MoreHorizontal className="ml-auto h-4 w-4 shrink-0 text-[#71767b]" />
          </p>
          <p className="mt-0.5 whitespace-pre-line break-words text-[15px] leading-[1.35]" aria-hidden="true">
            {draft.caption ? <Rich text={draft.caption} tagClass="text-[#1d9bf0]" /> : <span className="text-[#71767b]">What&apos;s happening?</span>}
          </p>
          {aspect ? (
            <FeedMedia src={src} poster={poster} aspect={aspect} clip={interactive ? clip : null} label="the X preview" className="mt-3 rounded-2xl border border-[#2f3336]" />
          ) : (
            <div className="mt-3 aspect-[4/5] max-h-[340px] w-full overflow-hidden rounded-2xl border border-[#2f3336]">
              <Media src={src} poster={poster} />
            </div>
          )}
          <div className="mt-3 flex justify-between pr-2 text-[13px] text-[#71767b]" aria-hidden="true">
            <MessageCircle className="h-4 w-4" />
            <Repeat2 className="h-4 w-4" />
            <Heart className="h-4 w-4" />
            <BarChart2 className="h-4 w-4" />
            <span className="flex items-center gap-3"><Bookmark className="h-4 w-4" /><Share className="h-4 w-4" /></span>
          </div>
        </div>
      </div>
    </article>
  );
}

/** TikTok, as it shows in the For You feed. */
function TikTokVideo({ draft, src, poster, handle, avatar, interactive, className }: PreviewProps) {
  const clip = useClip(interactive ? src : null);
  const caption = [draft.caption, draft.hashtags].filter(Boolean).join(" ");
  return (
    <div className={cn(FRAME, className)} role="group" aria-label={`TikTok preview. Caption: ${caption || "empty"}`}>
      <Media src={src} poster={poster} clip={interactive ? clip : null} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/80" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center gap-4 pt-3 text-[14px] font-semibold" aria-hidden="true">
        <span className="text-white/70">Following</span>
        <span className="border-b-2 border-white pb-0.5">For You</span>
      </div>
      <Rail items={[{ icon: Heart, fill: true }, { icon: MessageCircle, fill: true }, { icon: Bookmark, fill: true }, { icon: Share }]} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 space-y-1.5 p-3 pr-12" aria-hidden="true">
        <p className="truncate text-[14px] font-semibold">@{handle.replace(/^@/, "")}</p>
        <p className="line-clamp-3 whitespace-pre-line break-words text-[13px] leading-snug">
          {caption ? <Rich text={caption} tagClass="font-semibold" /> : <span className="text-white/60">Your caption shows here</span>}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-white/85">
          <Music2 className="h-3 w-3" /> Original sound · {handle}
        </p>
      </div>
      {interactive && src && <ClipControls clip={clip} label="the TikTok preview" className="left-2 top-11" />}
    </div>
  );
}

const FEED_LOOK: Partial<Record<Platform, { card: string; muted: string; tag: string; action: string[] }>> = {
  threads: { card: "bg-background text-foreground", muted: "text-muted-foreground", tag: "text-[#0095f6]", action: ["Like", "Reply", "Repost", "Share"] },
  facebook: { card: "bg-background text-foreground", muted: "text-muted-foreground", tag: "text-[#1877f2]", action: ["Like", "Comment", "Share"] },
  linkedin: { card: "bg-background text-foreground", muted: "text-muted-foreground", tag: "text-[#0a66c2] font-semibold", action: ["Like", "Comment", "Repost", "Send"] },
};

/** Threads, Facebook and LinkedIn: the post as it shows in the feed, with the title where that platform sends one. */
function FeedPost({ platform, draft, src, poster, handle, name, avatar, aspect, interactive, className }: PreviewProps & { platform: Platform }) {
  const clip = useClip(interactive ? src : null);
  const [more, setMore] = useState(false);
  const look = FEED_LOOK[platform] ?? FEED_LOOK.threads!;
  const meta = PLATFORM_META[platform];
  const text = [draft.caption, draft.hashtags].filter(Boolean).join("\n\n");
  const showTitle = (platform === "linkedin" || platform === "facebook") && draft.title.trim();
  return (
    <article className={cn("mx-auto w-full max-w-[440px] rounded-[22px] p-4 hairline", look.card, className)} aria-label={`${meta.name} preview: ${text || "empty"}`}>
      <div className="flex items-center gap-3" aria-hidden="true">
        <Avatar name={name} src={avatar} className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{platform === "threads" ? handle.replace(/^@/, "") : name}</p>
          <p className={cn("truncate text-xs", look.muted)}>{platform === "linkedin" ? handle : platform === "threads" ? "now" : "Just now"}</p>
        </div>
        <MoreHorizontal className={cn("h-4 w-4 shrink-0", look.muted)} />
      </div>
      {showTitle && <p className="mt-3 break-words text-[15px] font-semibold leading-snug" aria-hidden="true">{draft.title}</p>}
      <p className={cn("mt-2 whitespace-pre-line break-words text-[14px] leading-[1.45]", !more && "line-clamp-4")} aria-hidden="true">
        {text ? <Rich text={text} tagClass={look.tag} /> : <span className={look.muted}>Your caption shows here</span>}
      </p>
      {text.length > 180 && (
        <button type="button" onClick={() => setMore((m) => !m)} className={cn("mt-1 min-h-11 text-[13px] font-medium", look.muted)}>
          {more ? "Show less" : "See more"}
        </button>
      )}
      <FeedMedia src={src} poster={poster} aspect={aspect} clip={interactive ? clip : null} label={`the ${meta.name} preview`} className="mt-3 rounded-2xl bg-black" />
      <div className={cn("mt-3 flex justify-between gap-2 px-1 text-[13px]", look.muted)} aria-hidden="true">
        {look.action.map((a) => (
          <span key={a} className="flex items-center gap-1.5">
            {a === "Like" ? <ThumbsUp className="h-4 w-4" /> : a === "Comment" || a === "Reply" ? <MessageCircle className="h-4 w-4" /> : a === "Repost" ? <Repeat2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {platform === "threads" ? null : a}
          </span>
        ))}
      </div>
    </article>
  );
}

/** The right preview for any platform. Platforms without a look of their own get the feed card. */
export function PreviewFor({ platform, ...props }: PreviewProps & { platform: Platform }) {
  if (platform === "instagram") return <InstagramReel {...props} />;
  if (platform === "youtube") return <YouTubeShort {...props} />;
  if (platform === "x") return <XPost {...props} />;
  if (platform === "tiktok") return <TikTokVideo {...props} />;
  return <FeedPost platform={platform} {...props} />;
}
