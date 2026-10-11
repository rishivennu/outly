"use client";
import { useState } from "react";
import { BarChart2, Bookmark, Camera, Heart, MessageCircle, MoreHorizontal, Music2, Repeat2, Search, Send, Share, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Draft } from "./types";

export interface PreviewProps {
  draft: Draft;
  src: string | null;
  poster: string | null;
  handle: string;
  name: string;
  avatar?: string | null;
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

function Media({ src, poster, className }: { src: string | null; poster: string | null; className?: string }) {
  if (src) return <video src={src} poster={poster ?? undefined} muted loop autoPlay playsInline preload="metadata" aria-hidden="true" className={cn("h-full w-full object-cover", className)} />;
  if (poster)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={poster} alt="" className={cn("h-full w-full object-cover", className)} />;
  return <div className={cn("h-full w-full bg-gradient-to-br from-secondary to-background", className)} />;
}

function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={cn("rounded-full object-cover", className)} />
  ) : (
    <span className={cn("grid place-items-center rounded-full energy-bg text-[11px] font-bold text-black", className)} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Rail({ items }: { items: { icon: React.ElementType; label?: string; fill?: boolean }[] }) {
  return (
    <div className="absolute bottom-24 right-2 flex flex-col items-center gap-4 text-white" aria-hidden="true">
      {items.map(({ icon: I, label, fill }, i) => (
        <span key={i} className="flex flex-col items-center gap-0.5 drop-shadow">
          <I className={cn("h-6 w-6", fill && "fill-current")} strokeWidth={1.8} />
          {label && <span className="text-[10px] font-semibold">{label}</span>}
        </span>
      ))}
    </div>
  );
}

/** Instagram Reel, as it shows in the Reels tab. */
export function InstagramReel({ draft, src, poster, handle, avatar }: PreviewProps) {
  const [more, setMore] = useState(false);
  const caption = [draft.caption, draft.hashtags].filter(Boolean).join(" ");
  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-[26px] bg-black text-white hairline" role="group" aria-label={`Instagram Reel preview. Caption: ${caption || "empty"}`}>
      <Media src={src} poster={poster} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-3 text-[15px] font-bold" aria-hidden="true">
        Reels <Camera className="h-5 w-5" />
      </div>
      <Rail items={[{ icon: Heart, label: "12.4K" }, { icon: MessageCircle, label: "318" }, { icon: Send, label: "1.1K" }, { icon: MoreHorizontal }]} />
      <div className="absolute inset-x-0 bottom-0 space-y-2 p-3 pr-12">
        <div className="flex items-center gap-2" aria-hidden="true">
          <Avatar name={handle} src={avatar} className="h-7 w-7 ring-1 ring-white/40" />
          <span className="text-[13px] font-semibold">{handle}</span>
          <span className="rounded-lg border border-white/60 px-2 py-0.5 text-[11px] font-semibold">Follow</span>
        </div>
        <p className={cn("whitespace-pre-line text-[12.5px] leading-snug", !more && "line-clamp-2")} aria-hidden="true">
          {caption ? <Rich text={caption} tagClass="text-white/95 font-medium" /> : <span className="text-white/60">Your caption shows here</span>}
        </p>
        {caption.length > 80 && (
          <button type="button" onClick={() => setMore((m) => !m)} className="text-[12px] font-medium text-white/75">
            {more ? "less" : "… more"}
          </button>
        )}
        <div className="flex items-center gap-1.5 text-[11px] text-white/85" aria-hidden="true">
          <Music2 className="h-3 w-3" /> {handle} · Original audio
        </div>
      </div>
    </div>
  );
}

/** YouTube Short, as it shows in the Shorts player. */
export function YouTubeShort({ draft, src, poster, handle, avatar }: PreviewProps) {
  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-[26px] bg-black text-white hairline" role="img" aria-label={`YouTube Short preview. Title: ${draft.title || "empty"}`}>
      <Media src={src} poster={poster} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/85" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-end gap-4 px-4 pt-3" aria-hidden="true">
        <Search className="h-5 w-5" />
        <MoreHorizontal className="h-5 w-5 rotate-90" />
      </div>
      <Rail items={[{ icon: ThumbsUp, label: "8.9K", fill: true }, { icon: ThumbsDown, label: "Dislike", fill: true }, { icon: MessageCircle, label: "204", fill: true }, { icon: Share, label: "Share" }]} />
      <div className="absolute inset-x-0 bottom-0 space-y-2 p-3 pr-12">
        <p className="line-clamp-2 text-[13.5px] font-semibold leading-snug" aria-hidden="true">
          {draft.title || <span className="text-white/60">Your title shows here</span>}
        </p>
        <div className="flex items-center gap-2" aria-hidden="true">
          <Avatar name={handle} src={avatar} className="h-7 w-7" />
          <span className="text-[12.5px] font-medium">@{handle.replace(/^@/, "").replace(/\s+/g, "").toLowerCase()}</span>
          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-black">Subscribe</span>
        </div>
        {draft.hashtags && <p className="truncate text-[11px] text-white/80" aria-hidden="true">{draft.hashtags}</p>}
      </div>
    </div>
  );
}

/** X post, as it shows in the For You timeline. */
export function XPost({ draft, src, poster, handle, name, avatar }: PreviewProps) {
  return (
    <article className="mx-auto w-full max-w-[420px] rounded-[22px] bg-black p-4 text-[#e7e9ea] hairline" aria-label={`X post preview: ${draft.caption || "empty"}`}>
      <div className="flex gap-3">
        <Avatar name={name} src={avatar} className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[14.5px]" aria-hidden="true">
            <span className="truncate font-bold text-white">{name}</span>
            <span className="truncate text-[#71767b]">@{handle.replace(/^@/, "")} · now</span>
            <MoreHorizontal className="ml-auto h-4 w-4 shrink-0 text-[#71767b]" />
          </p>
          <p className="mt-0.5 whitespace-pre-line break-words text-[14.5px] leading-[1.35]" aria-hidden="true">
            {draft.caption ? <Rich text={draft.caption} tagClass="text-[#1d9bf0]" /> : <span className="text-[#71767b]">What&apos;s happening?</span>}
          </p>
          <div className="mt-3 aspect-[4/5] max-h-[340px] w-full overflow-hidden rounded-2xl border border-[#2f3336]">
            <Media src={src} poster={poster} />
          </div>
          <div className="mt-3 flex justify-between pr-2 text-[12.5px] text-[#71767b]" aria-hidden="true">
            <span className="flex items-center gap-1.5"><MessageCircle className="h-4 w-4" /> 48</span>
            <span className="flex items-center gap-1.5"><Repeat2 className="h-4 w-4" /> 212</span>
            <span className="flex items-center gap-1.5"><Heart className="h-4 w-4" /> 1.6K</span>
            <span className="flex items-center gap-1.5"><BarChart2 className="h-4 w-4" /> 41K</span>
            <span className="flex items-center gap-3"><Bookmark className="h-4 w-4" /><Share className="h-4 w-4" /></span>
          </div>
        </div>
      </div>
    </article>
  );
}
