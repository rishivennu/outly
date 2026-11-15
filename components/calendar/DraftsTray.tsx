"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { CalendarPost } from "@/lib/calendar/load";
import { PostCard } from "./PostCard";
import type { CardHandlers } from "./DayView";

/** Drafts with no date never sit on a day: they wait here until someone gives them a time. */
export function DraftsTray({ posts, hasMore, loading, onMore, ...h }: CardHandlers & { posts: CalendarPost[]; hasMore: boolean; loading: boolean; onMore: () => void }) {
  if (!posts.length) return null;
  return (
    <section aria-labelledby="cal-drafts" className="mt-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="cal-drafts" className="text-sm font-semibold">
          Unscheduled drafts
        </h2>
        <Link href="/content?filter=draft" className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:underline">
          All drafts
        </Link>
      </div>
      <ol className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {posts.map((p) => (
          <li key={p.id} className="min-w-0">
            <PostCard post={p} status={h.statusOf(p)} tz={h.tz} variant="row" onOpen={h.onOpen} onMove={h.onMove} />
          </li>
        ))}
      </ol>
      {hasMore && (
        <Button variant="ghost" className="mt-2" onClick={onMore} disabled={loading}>
          {loading ? "Loading\u2026" : "Show more drafts"}
        </Button>
      )}
    </section>
  );
}
