"use client";
import { memo } from "react";
import { motion } from "framer-motion";
import { CalendarClock } from "lucide-react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { fmt, tzShort } from "@/components/shell/UserContext";
import { PLATFORM_META } from "@/lib/domain";
import { DISPLAY_LABEL, type DisplayStatus } from "@/lib/posts/attention";
import { placedAt } from "@/lib/calendar/range";
import { cn } from "@/lib/utils";
import type { CalendarPost } from "@/lib/calendar/load";

/** Can be dragged or moved: a booked post, or a draft that already has a time saved with it. */
export const movable = (p: Pick<CalendarPost, "status" | "scheduledAt">) => p.status === "scheduled" || (p.status === "draft" && !!p.scheduledAt);

/** The words a creator wrote for it: the first caption, else the hook, else the story. */
export function captionOf(p: Pick<CalendarPost, "targets" | "hook" | "story">) {
  const c = p.targets.map((t) => t.caption ?? t.description).find((x) => x?.trim());
  return (c ?? p.hook ?? p.story ?? "").replace(/\s+/g, " ").trim();
}

const titleOf = (p: CalendarPost) => p.title ?? p.hook?.split("\n")[0] ?? "Untitled";
const platformsLabel = (p: CalendarPost) => [...new Set(p.targets.map((t) => PLATFORM_META[t.platform]?.name ?? t.platform))].join(", ");

type Props = {
  post: CalendarPost;
  status: DisplayStatus;
  tz: string;
  variant: "tile" | "row" | "chip";
  onOpen: (p: CalendarPost) => void;
  onMove?: (p: CalendarPost) => void;
  dragging?: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
};

function Draggable({ post, dragging, onDragStart, onDragEnd, className, children }: Pick<Props, "post" | "dragging" | "onDragStart" | "onDragEnd"> & { className?: string; children: React.ReactNode }) {
  const can = movable(post) && !!onDragStart;
  return (
    <div
      draggable={can}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-outlly-post", post.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.(post.id);
      }}
      onDragEnd={() => onDragEnd?.()}
      className={cn(can && "cursor-grab active:cursor-grabbing", dragging && "opacity-50", className)}
    >
      {children}
    </div>
  );
}

function PostCardImpl(props: Props) {
  const { post: p, status, tz, variant, onOpen, onMove } = props;
  const when = placedAt(p);
  const time = when ? fmt(when, tz, { hour: "numeric", minute: "2-digit" }) : null;
  const label = `${titleOf(p)}, ${when ? fmt(when, tz, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) : "no date"}, ${DISPLAY_LABEL[status]}${p.targets.length ? `, ${platformsLabel(p)}` : ""}`;

  if (variant === "chip")
    return (
      <Draggable {...props}>
        <button
          type="button"
          onClick={() => onOpen(p)}
          aria-label={label}
          className={cn(
            "flex min-h-11 w-full items-center gap-1.5 rounded-xl px-1.5 text-left text-xs transition-colors duration-200 [@media(hover:hover)]:hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            status === "attention" || status === "failed" ? "bg-warning/10" : "bg-secondary/50",
          )}
        >
          <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[status])} aria-hidden="true" />
          {time && <span className="tabular-nums shrink-0 font-semibold">{time}</span>}
          <span className="min-w-0 truncate text-muted-foreground">{titleOf(p)}</span>
        </button>
      </Draggable>
    );

  if (variant === "row") {
    const caption = captionOf(p);
    return (
      <Draggable {...props} className="flex min-w-0 items-stretch gap-2">
        <button
          type="button"
          onClick={() => onOpen(p)}
          aria-label={label}
          className="group flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-2xl bg-card/60 p-2.5 text-left hairline transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.96] motion-reduce:transition-none [@media(hover:hover)]:hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="relative aspect-[3/4] w-14 shrink-0 overflow-hidden rounded-xl bg-secondary hairline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.media.thumbnailUrl && <img src={p.media.thumbnailUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
          </span>
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {when ? (
                <span className="tabular-nums text-xs font-semibold">
                  {fmt(when, tz, { weekday: "short", month: "short", day: "numeric" })}, {time} <span className="font-medium text-muted-foreground">{tzShort(tz)}</span>
                </span>
              ) : (
                <span className="text-xs font-semibold text-muted-foreground">No date yet</span>
              )}
              <StatusBadge status={status} className="py-0.5" />
            </span>
            <span className="block truncate text-sm font-semibold">{titleOf(p)}</span>
            {caption && <span className="line-clamp-2 text-xs text-muted-foreground">{caption}</span>}
            {p.targets.length > 0 && (
              <span className="flex -space-x-1.5 pt-0.5" aria-hidden="true">
                {p.targets.map((t) => (
                  <PlatformOrb key={t.id} platform={t.platform} size={18} ring />
                ))}
              </span>
            )}
          </span>
        </button>
        {onMove && (p.status === "scheduled" || p.status === "draft") ? (
          <button
            type="button"
            onClick={() => onMove(p)}
            aria-label={`Move ${titleOf(p)}`}
            className="grid min-h-11 w-11 shrink-0 place-items-center rounded-2xl text-muted-foreground hairline transition-[background-color,color,transform] duration-200 active:scale-[0.96] motion-reduce:transition-none [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </Draggable>
    );
  }

  const caption = captionOf(p);
  return (
    <Draggable {...props}>
      <motion.button
        layout
        type="button"
        onClick={() => onOpen(p)}
        whileHover={{ y: -2, rotate: -0.6 }}
        className={cn("group relative block aspect-[4/5] w-full overflow-hidden rounded-2xl text-left hairline md:aspect-[3/4]", p.status === "published" && "opacity-75 [@media(hover:hover)]:hover:opacity-100")}
        aria-label={label}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.media.thumbnailUrl && <img src={p.media.thumbnailUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 [@media(hover:hover)]:group-hover:scale-105 motion-reduce:transition-none" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/40" />
        {time && <span className="tabular-nums absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur">{time}</span>}
        <div className="absolute inset-x-0 bottom-0 p-2.5 text-white">
          <p className="line-clamp-2 text-[13px] font-semibold leading-tight">{titleOf(p)}</p>
          {caption && <p className="mt-1 line-clamp-2 text-xs leading-snug text-white/80 max-md:hidden">{caption}</p>}
          <span className="mt-1.5 flex -space-x-1.5">
            {p.targets.map((t) => (
              <PlatformOrb key={t.id} platform={t.platform} size={18} ring />
            ))}
          </span>
        </div>
        {status !== "scheduled" && <StatusBadge status={status} className="absolute left-2 top-8 max-w-[calc(100%-1rem)] overflow-hidden whitespace-nowrap md:left-auto md:right-2 md:top-2" />}
      </motion.button>
    </Draggable>
  );
}

const DOT: Record<DisplayStatus, string> = {
  draft: "bg-muted-foreground",
  scheduled: "bg-accent",
  publishing: "bg-accent",
  published: "bg-success",
  failed: "bg-destructive",
  attention: "bg-warning",
};

export const PostCard = memo(PostCardImpl);
