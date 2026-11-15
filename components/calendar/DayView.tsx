"use client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/shared/Skeleton";
import type { CalendarPost } from "@/lib/calendar/load";
import type { DisplayStatus } from "@/lib/posts/attention";
import { PostCard } from "./PostCard";

export type CardHandlers = {
  tz: string;
  statusOf: (p: CalendarPost) => DisplayStatus;
  onOpen: (p: CalendarPost) => void;
  onMove: (p: CalendarPost) => void;
};

/** One day, in time order, with room for the caption. */
export function DayView({ posts, past, loading, ...h }: CardHandlers & { posts: CalendarPost[]; past: boolean; loading: boolean }) {
  if (loading && !posts.length)
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading this day">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  if (!posts.length)
    return (
      <div className="rounded-[24px] p-6 text-center card-glass bg-card/50 hairline">
        <p className="text-muted-foreground">{past ? "Nothing went out this day." : "Nothing is booked for this day yet."}</p>
        {!past && (
          <Link href="/create" className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium hairline transition-colors duration-200 [@media(hover:hover)]:hover:bg-secondary">
            <Plus className="h-4 w-4" aria-hidden="true" /> Plan something
          </Link>
        )}
      </div>
    );
  return (
    <ol className="space-y-2">
      {posts.map((p) => (
        <li key={p.id}>
          <PostCard post={p} status={h.statusOf(p)} tz={h.tz} variant="row" onOpen={h.onOpen} onMove={h.onMove} />
        </li>
      ))}
    </ol>
  );
}
