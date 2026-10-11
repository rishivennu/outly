"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D, type IconName } from "@/components/brand/Icon3D";
import { Thumb } from "@/components/shared/Thumb";
import { CardWall } from "@/components/shared/CardWall";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { fmt, useUser } from "@/components/shell/UserContext";
import { PostSheet } from "@/components/posts/PostSheet";
import { cn, compact, formatDuration } from "@/lib/utils";
import type { PostView } from "@/lib/services";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "scheduled", label: "Scheduled" },
  { id: "published", label: "Published" },
  { id: "failed", label: "Failed" },
] as const;
type F = (typeof FILTERS)[number]["id"];

const match = (p: PostView, f: F) => f === "all" || (f === "failed" ? ["failed", "partial"].includes(p.status) : f === "published" ? p.status === "published" : p.status === f);

export function ContentLibrary({ initial, views }: { initial: PostView[]; views: Record<string, number> }) {
  const { timezone: tz } = useUser();
  const [posts, setPosts] = useState(initial);
  const [filter, setFilter] = useState<F>("all");
  const [open, setOpen] = useState<PostView | null>(null);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, posts.filter((p) => match(p, f.id)).length])) as Record<F, number>, [posts]);
  const shown = posts.filter((p) => match(p, filter));

  return (
    <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14">
      <header className="relative -mx-5 -mt-8 overflow-hidden px-5 pt-10 text-center sm:-mx-10 sm:px-10 lg:-mt-14 lg:pt-16">
        <div className="pointer-events-none absolute left-1/2 top-[-140px] h-[320px] w-[min(900px,90%)] -translate-x-1/2 rounded-full bg-accent/25 blur-[90px] dark:bg-accent/30" aria-hidden="true" />
        <p className="eyebrow relative mb-3">Content</p>
        <h1 className="display fade-title relative text-[clamp(2.8rem,8vw,6.2rem)] tracking-[-0.045em]">Everything you&apos;ve made.</h1>
        <p className="glass relative mt-4 inline-flex rounded-full px-4 py-1.5 text-sm text-muted-foreground">
          {posts.length} {posts.length === 1 ? "piece" : "pieces"} · {posts.filter((p) => p.status === "published").length} live
        </p>
        {posts.length >= 4 && <CardWall images={posts.map((p) => p.media.thumbnailUrl)} className="mt-4 hidden sm:flex" height={330} />}
        <div className={cn("relative flex justify-center", posts.length >= 4 ? "-mt-10" : "mt-8")}>
          <Button asChild variant="lime" size="lg">
            <Link href="/create">
              <Plus className="h-5 w-5" /> Make something new
            </Link>
          </Button>
        </div>
      </header>

      <div role="tablist" aria-label="Filter by status" className="scrollbar-none -mx-1 mt-8 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className={cn("relative h-11 shrink-0 rounded-full px-4 text-sm font-medium transition", filter === f.id ? "text-[hsl(var(--lime-foreground))]" : "text-muted-foreground hairline hover:text-foreground")}>
            {filter === f.id && <motion.span layoutId="content-filter" className="lime-bg absolute inset-0 rounded-full" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span className="relative">
              {f.label} <span className="tabular opacity-60">{counts[f.id]}</span>
            </span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty filter={filter} />
      ) : (
        <motion.ul layout className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          <AnimatePresence>
            {shown.map((p, i) => (
              <motion.li key={p.id} layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.03, 0.3) } }} exit={{ opacity: 0, scale: 0.95 }}>
                <button type="button" onClick={() => setOpen(p)} className="group block w-full text-left" aria-label={`${p.title ?? "Untitled"}, ${p.status}. Open details`}>
                  <div className="relative aspect-[9/16] overflow-hidden rounded-[24px] hairline transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_30px_60px_-30px_hsl(var(--energy-b)/0.6)]">
                    <Thumb src={p.media.thumbnailUrl} video={p.media.url} alt="" className="absolute inset-0" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/30" />
                    <StatusBadge status={p.status} className="absolute left-3 top-3" />
                    {p.media.duration ? <span className="tabular absolute right-3 top-3 rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-white backdrop-blur">{formatDuration(p.media.duration)}</span> : null}
                    <div className="absolute inset-x-0 bottom-0 p-3.5 text-white">
                      <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{p.title ?? "Untitled idea"}</p>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-white/80">
                        <span className="flex -space-x-1.5">
                          {p.targets.map((t) => (
                            <PlatformOrb key={t.id} platform={t.platform} size={22} ring />
                          ))}
                        </span>
                        <span className="truncate">
                          {p.status === "published" && views[p.id] ? `${compact(views[p.id])} views` : p.status === "scheduled" && p.scheduledAt ? fmt(p.scheduledAt, tz, { weekday: "short", hour: "numeric", minute: "2-digit" }) : fmt(p.updatedAt, tz, { month: "short", day: "numeric" })}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}

      <PostSheet
        post={open}
        onClose={() => setOpen(null)}
        onChange={(np) => {
          setPosts((ps) => ps.map((x) => (x.id === np.id ? np : x)));
          setOpen(np);
        }}
        onRemove={(id) => setPosts((ps) => ps.filter((x) => x.id !== id))}
        onDuplicate={(np) => {
          setPosts((ps) => [np, ...ps]);
          setOpen(np);
        }}
      />
    </div>
  );
}

function Empty({ filter }: { filter: F }) {
  const copy: Record<F, [string, string, IconName]> = {
    all: ["Nothing here yet.", "Your first video is one drop away.", "gallery"],
    draft: ["No drafts.", "Everything you started, you finished. Look at you.", "drafts"],
    scheduled: ["Nothing on the calendar.", "Schedule something and it'll wait here.", "schedule"],
    published: ["Nothing live yet.", "Send your first one out. It's a good feeling.", "publish"],
    failed: ["Nothing went wrong.", "Every post made it where it was going.", "success"],
  };
  return (
    <div className="mt-16 flex flex-col items-center text-center">
      <Icon3D name={copy[filter][2]} size={104} className="animate-bob mb-8" />
      <p className="text-2xl font-semibold tracking-tight">{copy[filter][0]}</p>
      <p className="mt-2 text-muted-foreground">{copy[filter][1]}</p>
      {filter !== "failed" && (
        <Button asChild variant="primary" className="mt-6">
          <Link href="/create">
            <Plus className="h-4 w-4" /> Make something
          </Link>
        </Button>
      )}
    </div>
  );
}
