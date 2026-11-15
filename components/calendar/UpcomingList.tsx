"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/shared/Skeleton";
import { fmt } from "@/components/shell/UserContext";
import { dayKey } from "@/lib/client/tz";
import type { CalendarPost } from "@/lib/calendar/load";
import { PostCard } from "./PostCard";
import type { CardHandlers } from "./DayView";

/** Everything booked from now on, a page at a time, under a heading per day. */
export function UpcomingList({ posts, hasMore, loading, error, onMore, ...h }: CardHandlers & { posts: CalendarPost[]; hasMore: boolean; loading: boolean; error: string | null; onMore: () => void }) {
  const groups: { key: string; items: CalendarPost[] }[] = [];
  for (const p of posts) {
    const k = dayKey(new Date(p.scheduledAt!), h.tz);
    const last = groups[groups.length - 1];
    if (last?.key === k) last.items.push(p);
    else groups.push({ key: k, items: [p] });
  }
  if (loading && !posts.length)
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading what's coming up">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  if (!posts.length && !error)
    return (
      <div className="rounded-[24px] p-6 text-center card-glass bg-card/50 hairline">
        <p className="text-muted-foreground">Nothing is booked from now on.</p>
        <Link href="/create" className="mt-3 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium hairline transition-colors duration-200 [@media(hover:hover)]:hover:bg-secondary">
          Plan a post
        </Link>
      </div>
    );
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`up-${g.key}`}>
          <h2 id={`up-${g.key}`} className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {fmt(new Date(`${g.key}T12:00:00Z`), "UTC", { weekday: "long", month: "long", day: "numeric" })}
          </h2>
          <ol className="space-y-2">
            {g.items.map((p) => (
              <li key={p.id}>
                <PostCard post={p} status={h.statusOf(p)} tz={h.tz} variant="row" onOpen={h.onOpen} onMove={h.onMove} />
              </li>
            ))}
          </ol>
        </section>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {(hasMore || error) && (
        <Button variant="subtle" className="w-full sm:w-auto" onClick={onMore} disabled={loading}>
          {loading ? "Loading\u2026" : error ? "Try again" : "Show more"}
        </Button>
      )}
    </div>
  );
}
