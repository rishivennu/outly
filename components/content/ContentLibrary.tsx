"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D, type IconName } from "@/components/brand/Icon3D";
import { Thumb } from "@/components/shared/Thumb";
import { CardWall } from "@/components/shared/CardWall";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { fmt, useUser } from "@/components/shell/UserContext";
import { PostSheet } from "@/components/posts/PostSheet";
import { ReelAnalytics } from "@/components/content/ReelAnalytics";
import { DeviceDrafts } from "@/components/create/DeviceDrafts";
import { cn, compact, formatDuration } from "@/lib/utils";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { api } from "@/lib/client/api";
import { mergeFresh } from "@/lib/client/preload";
import { useTabMemory } from "@/lib/client/tab-state";
import { deleteCopy, deletePosts, isFailedPost } from "@/lib/client/failed-posts";
import type { PostView } from "@/lib/services";
import type { LibraryCounts, LibraryPage } from "@/lib/posts/library";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "scheduled", label: "Scheduled" },
  { id: "published", label: "Published" },
  { id: "failed", label: "Failed" },
] as const;
type F = (typeof FILTERS)[number]["id"];

/** `/content?filter=draft` opens straight on that tab, so a "Saved to Drafts" link can land here. */
export const filterFromParam = (v: string | null | undefined): F => (FILTERS.some((f) => f.id === v) ? (v as F) : "all");

/** Live on at least one platform (published or partly published). */
const hasLive = (p: PostView) => p.targets.some((t) => t.status === "published");

const match = (p: PostView, f: F) => f === "all" || (f === "failed" ? ["failed", "partial"].includes(p.status) : f === "published" ? p.status === "published" : p.status === f);

const countIn = (list: Iterable<PostView>, f: F) => {
  let n = 0;
  for (const p of list) if (match(p, f)) n++;
  return n;
};

/**
 * 1091: the library arrives one page at a time. `counts` are the server's totals for every post; posts
 * we have loaded and then changed here (deleted, duplicated, published) adjust them, so the tabs stay true
 * without loading everything.
 */
export function ContentLibrary({
  initial,
  views: initialViews,
  counts: serverCounts,
  nextCursor: firstCursor = null,
}: {
  initial: PostView[];
  views: Record<string, number>;
  counts?: LibraryCounts;
  nextCursor?: string | null;
}) {
  const { timezone: tz } = useUser();
  const [posts, setPosts] = useState(initial);
  const [views, setViews] = useState(initialViews);
  // One cursor per tab: "All" pages through everything, another tab through its own posts only.
  // Missing = that tab has not fetched yet; null = nothing more to fetch.
  const [cursors, setCursors] = useState<Partial<Record<F, string | null>>>({ all: firstCursor });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreErr, setMoreErr] = useState<string | null>(null);
  // Every post as the server sent it: the difference to `posts` is what changed on this page.
  const baseline = useRef(new Map(initial.map((p) => [p.id, p] as const)));
  const params = useSearchParams();
  // 1114: with no ?filter= in the link (the tab bar's), the filter you left the library on comes back.
  const kept = useTabMemory<F>("content", (v) => (typeof v === "string" && FILTERS.some((f) => f.id === v) ? (v as F) : null));
  const restored = !params?.get("filter") && kept.saved && kept.saved !== "all" ? kept.saved : null;
  const [filter, setFilter] = useState<F>(() => restored ?? filterFromParam(params?.get("filter")));
  const { save: saveFilter } = kept;
  useEffect(() => saveFilter(filter), [filter, saveFilter]);
  useEffect(() => {
    if (restored) window.history.replaceState(null, "", `/content?filter=${restored}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 1114: a newer server render (bringing a preloaded copy up to date) refreshes the first page and keeps the rest.
  const firstPage = useRef(initial);
  useEffect(() => {
    if (initial === firstPage.current) return;
    firstPage.current = initial;
    for (const p of initial) baseline.current.set(p.id, p);
    setPosts((ps) => mergeFresh(initial, ps));
    setViews((v) => ({ ...v, ...initialViews }));
  }, [initial, initialViews]);
  const [open, setOpen] = useState<PostView | null>(null);
  // 1088: a post that is live somewhere opens its analytics first; "Details and actions" leads on to the sheet.
  const [stats, setStats] = useState<PostView | null>(null);
  // ?open=<id> (from the command palette) opens that post. One beat after arriving: the palette hands
  // focus back as it closes, and a sheet opened in that same moment would read it as "clicked outside".
  const want = params?.get("open") ?? null;
  // 1114: read through a ref, so a newer server render (PageFresh) never reopens the sheet over your edits.
  const initialNow = useRef(initial);
  initialNow.current = initial;
  useEffect(() => {
    if (!want) return;
    let gone = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const p = initialNow.current.find((x) => x.id === want);
    if (p) t = setTimeout(() => setOpen(p), 80);
    // Not on the first page: fetch just that one (the server checks it is ours).
    else
      void api<{ post: PostView }>(`/api/posts/${want}`)
        .then((r) => !gone && setOpen(r.post))
        .catch(() => {});
    return () => {
      gone = true;
      if (t) clearTimeout(t);
    };
  }, [want]);
  const counts = useMemo(() => {
    const local = Object.fromEntries(FILTERS.map((f) => [f.id, countIn(posts, f.id)])) as Record<F, number>;
    if (!serverCounts) return local;
    const base = baseline.current.values();
    const list = [...base];
    return Object.fromEntries(FILTERS.map((f) => [f.id, Math.max(local[f.id], serverCounts[f.id] - countIn(list, f.id) + local[f.id])])) as Record<F, number>;
  }, [posts, serverCounts]);
  const shown = posts.filter((p) => match(p, filter));
  // What "Show more" would fetch on this tab: a cursor, "start" (first page of the tab), or null (all here).
  const nextFor = (f: F): string | null => {
    if (cursors.all === null) return null;
    if (f === "all") return cursors.all ?? null;
    if (f in cursors) return cursors[f] ?? null;
    return countIn(posts, f) < counts[f] ? "start" : null;
  };
  const next = nextFor(filter);
  const loadMore = async (f: F = filter) => {
    const c = nextFor(f);
    if (!c || loadingMore) return;
    setLoadingMore(true);
    setMoreErr(null);
    try {
      const q = new URLSearchParams({ library: "1" });
      if (f !== "all") q.set("status", f);
      if (c !== "start") q.set("cursor", c);
      const r = await api<LibraryPage>(`/api/posts?${q}`);
      for (const p of r.posts) if (!baseline.current.has(p.id)) baseline.current.set(p.id, p);
      setPosts((ps) => {
        const have = new Set(ps.map((x) => x.id));
        return [...ps, ...r.posts.filter((x) => !have.has(x.id))];
      });
      setViews((v) => ({ ...v, ...r.views }));
      setCursors((cs) => ({ ...cs, [f]: r.nextCursor }));
    } catch {
      setMoreErr("We couldn't load more just now. Try again in a moment.");
    } finally {
      setLoadingMore(false);
    }
  };
  // Opening a tab whose posts are not loaded yet fetches its first page instead of showing "nothing here".
  useEffect(() => {
    if (filter !== "all" && nextFor(filter) === "start") void loadMore(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);
  const toast = useToast();
  // Delete failed posts from Outlly: one card's trash button, or every failed one from the Failed tab.
  const [del, setDel] = useState<PostView[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const failedPosts = posts.filter(isFailedPost);
  const confirmDelete = async () => {
    if (!del) return;
    setDeleting(true);
    const r = await deletePosts(del.map((p) => p.id), (id) => api(`/api/posts/${id}`, { method: "DELETE" }));
    setDeleting(false);
    setPosts((ps) => ps.filter((x) => !r.done.includes(x.id)));
    setDel(null);
    if (r.failed.length) toast(`Deleted ${r.done.length}. ${r.failed.length} couldn't go, try again in a moment.`, "error");
    else toast(r.done.length === 1 ? "Deleted from Outlly." : `Deleted ${r.done.length} posts from Outlly.`, "info");
  };
  const copy = del ? deleteCopy(del) : null;

  return (
    <div className="page-frame pb-16 pt-8 lg:pt-14">
      <header className="frame-bleed relative -mt-8 overflow-hidden pt-10 text-center lg:-mt-14 lg:pt-16">
        <div className="pointer-events-none absolute left-1/2 top-[-140px] h-[320px] w-[min(900px,90%)] -translate-x-1/2 rounded-full bg-accent/25 blur-[90px] dark:bg-accent/30" aria-hidden="true" />
        <p className="eyebrow relative mb-3">Content</p>
        <h1 className="display fade-title relative text-[clamp(2.8rem,8vw,6.2rem)] tracking-[-0.045em]">Everything you&apos;ve made.</h1>
        <p className="glass relative mt-4 inline-flex rounded-full px-4 py-1.5 text-sm text-muted-foreground">
          {counts.all} {counts.all === 1 ? "piece" : "pieces"} · {counts.published} live
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
        {FILTERS.filter((f) => f.id === "all" || f.id === filter || counts[f.id] > 0).map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => {
              setFilter(f.id);
              window.history.replaceState(null, "", f.id === "all" ? "/content" : `/content?filter=${f.id}`);
            }} className={cn("relative h-11 shrink-0 rounded-full px-4 text-sm font-medium transition", filter === f.id ? "text-background" : "text-muted-foreground hairline hover:text-foreground")}>
            {filter === f.id && <motion.span layoutId="content-filter" className="bg-foreground absolute inset-0 rounded-full" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span className="relative">
              {f.label} <span className={cn("tabular", filter === f.id && "opacity-60")}>{counts[f.id]}</span>
            </span>
          </button>
        ))}
      </div>

      {filter === "draft" && <DeviceDrafts className="mt-8" limit={8} heading="Also saved on this device" grid="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" />}

      {filter === "failed" && failedPosts.length > 1 && (
        <div className="mt-6 flex justify-end">
          <Button variant="danger" size="sm" className="min-h-[44px]" onClick={() => setDel(failedPosts)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete all {failedPosts.length} failed
          </Button>
        </div>
      )}

      {shown.length === 0 && loadingMore ? (
        <p className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading...
        </p>
      ) : shown.length === 0 ? (
        <Empty filter={filter} />
      ) : (
        <motion.ul layout className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          <AnimatePresence>
            {shown.map((p, i) => (
              <motion.li key={p.id} className="relative" layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.03, 0.3) } }} exit={{ opacity: 0, scale: 0.95 }}>
                <button type="button" onClick={() => (hasLive(p) ? setStats(p) : setOpen(p))} className="group block w-full text-left" aria-label={`${p.title ?? "Untitled"}, ${p.status}. ${hasLive(p) ? "Open analytics" : "Open details"}`}>
                  <div className="relative aspect-[9/16] overflow-hidden rounded-[24px] hairline transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_30px_60px_-30px_hsl(var(--energy-b)/0.6)]">
                    <Thumb src={p.media.thumbnailUrl} video={p.media.url} alt="" className="absolute inset-0" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/30" />
                    <StatusBadge status={p.status} className="absolute left-3 top-3" />
                    {p.media.duration ? <span className={cn("tabular absolute right-3 rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-white backdrop-blur", isFailedPost(p) ? "top-[3.6rem]" : "top-3")}>{formatDuration(p.media.duration)}</span> : null}
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
                {isFailedPost(p) && (
                  <button
                    type="button"
                    onClick={() => setDel([p])}
                    aria-label={`Delete ${p.title ?? "Untitled idea"} from Outlly`}
                    className="absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-[hsl(0_72%_45%)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}

      {next && (shown.length > 0 || !loadingMore) && (
        <div className="mt-8 flex flex-col items-center gap-2">
          <Button variant="subtle" onClick={() => void loadMore()} disabled={loadingMore} className="min-h-[44px]">
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {loadingMore ? "Loading..." : filter === "all" ? `Show more (${Math.max(0, counts.all - posts.length)} more)` : `Show more (${Math.max(0, counts[filter] - shown.length)} more)`}
          </Button>
          {moreErr && (
            <p role="alert" className="text-sm text-destructive">
              {moreErr}
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && !deleting && setDel(null)}
        title={copy?.title ?? ""}
        body={copy?.body ?? ""}
        confirmLabel={deleting ? "Deleting..." : (copy?.confirm ?? "Delete")}
        busy={deleting}
        onConfirm={confirmDelete}
      />

      <ReelAnalytics
        post={stats}
        onClose={() => setStats(null)}
        onDetails={(p) => {
          setStats(null);
          // One beat later, so the sheet doesn't read the popup's closing focus as an outside click.
          setTimeout(() => setOpen(posts.find((x) => x.id === p.id) ?? p), 80);
        }}
      />

      <PostSheet
        post={open}
        onClose={() => {
          setOpen(null);
          if (want) window.history.replaceState(null, "", filter === "all" ? "/content" : `/content?filter=${filter}`);
        }}
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
    draft: ["No drafts.", "Everything you started, you finished. Drafts you leave for 3 days are removed.", "drafts"],
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
