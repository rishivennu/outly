"use client";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ListChecks, Loader2, Plus, Search, Trash2, X } from "lucide-react";
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
import { useUndoDelete } from "@/components/shared/useUndoDelete";
import { api, ApiError } from "@/lib/client/api";
import { mergeFresh } from "@/lib/client/preload";
import { useTabMemory } from "@/lib/client/tab-state";
import { isFailedPost } from "@/lib/client/failed-posts";
import { keepaliveDelete, reinsert } from "@/lib/client/deferred-delete";
import { bulkDeleteCopy, matchesQuery, selectRange } from "@/lib/client/library-tools";
import type { PostView } from "@/lib/services";
import type { LibraryCounts, LibraryPage } from "@/lib/posts/library";
import { T } from "@/lib/motion/tokens";

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
  const later = useUndoDelete();

  // 1148: search. Every post loaded: filtered here as you type. Otherwise the server searches the whole library.
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const searchRef = useRef<HTMLInputElement>(null);
  const allLoaded = cursors.all === null;
  type Found = { key: string; posts: PostView[]; next: string | null; loading: boolean; err: string | null };
  const [found, setFound] = useState<Found | null>(null);
  const searchKey = `${filter}|${q}`;
  const searchPage = async (key: string, cursor: string | null) => {
    setFound((f) => (f && f.key === key ? { ...f, loading: true, err: null } : { key, posts: [], next: null, loading: true, err: null }));
    try {
      const p = new URLSearchParams({ library: "1", q });
      if (filter !== "all") p.set("status", filter);
      if (cursor) p.set("cursor", cursor);
      const r = await api<LibraryPage>(`/api/posts?${p}`);
      setViews((v) => ({ ...v, ...r.views }));
      setFound((f) => {
        if (f && f.key !== key) return f;
        const base = cursor ? (f?.posts ?? []) : [];
        const have = new Set(base.map((x) => x.id));
        return { key, posts: [...base, ...r.posts.filter((x) => !have.has(x.id))], next: r.nextCursor, loading: false, err: null };
      });
    } catch {
      setFound((f) => (f && f.key === key ? { ...f, loading: false, err: "Search didn't go through. Check your connection and try again." } : f));
    }
  };
  useEffect(() => {
    if (!q || allLoaded) return setFound(null);
    void searchPage(searchKey, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, allLoaded]);
  const remote = q && !allLoaded && found?.key === searchKey ? found : null;
  // Local matches show at once; the server's answer replaces them when it lands.
  const list = !q ? shown : remote && (remote.posts.length || !remote.loading) ? remote.posts.filter((p) => match(p, filter)) : shown.filter((p) => matchesQuery(p, q));
  const clearSearch = () => {
    setQuery("");
    setQ("");
    searchRef.current?.focus();
  };

  // 1148: multi-select. "Select" turns every card into a checkbox (phones); on a desktop the box shows on hover
  // or focus and shift-click picks a run of cards.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<number | null>(null);
  const picking = selecting || selected.size > 0;
  const toggle = (index: number, shift: boolean) => {
    setSelected((s) => selectRange(list.map((p) => p.id), s, anchor.current, index, shift));
    anchor.current = index;
  };
  const clearSelection = () => {
    setSelected(new Set());
    setSelecting(false);
    anchor.current = null;
  };
  useEffect(clearSelection, [filter]);
  const visibleIds = list.map((p) => p.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  // Deleting from Outlly: one card's trash button (failed posts), every failed one, or the selection. The cards go at
  // once; the request waits for the Undo toast. Studio only: anything live on a platform stays up there.
  const [del, setDel] = useState<PostView[] | null>(null);
  const failedPosts = posts.filter(isFailedPost);
  const deleteLater = (ps: PostView[]) => {
    if (!ps.length) return;
    const ids = ps.map((p) => p.id);
    const gone = new Set(ids);
    const at = new Map(ps.map((p) => [p.id, posts.findIndex((x) => x.id === p.id)] as const));
    const inFound = new Map(ps.map((p) => [p.id, found?.posts.findIndex((x) => x.id === p.id) ?? -1] as const));
    setPosts((xs) => xs.filter((x) => !gone.has(x.id)));
    setFound((f) => (f ? { ...f, posts: f.posts.filter((x) => !gone.has(x.id)) } : f));
    setSelected((s) => new Set([...s].filter((id) => !gone.has(id))));
    const restore = (back: PostView[]) => {
      setPosts((xs) => back.reduce((acc, p) => reinsert(acc, p, at.get(p.id) ?? 0), xs));
      setFound((f) => (f ? { ...f, posts: back.reduce((acc, p) => ((inFound.get(p.id) ?? -1) >= 0 ? reinsert(acc, p, inFound.get(p.id)!) : acc), f.posts) } : f));
    };
    later(
      `posts:${ids.join(",")}`,
      {
        commit: async () => {
          const r = await api<{ done: string[]; failed: { id: string; error: string }[] }>("/api/posts/bulk", { method: "DELETE", json: { ids } });
          if (!r.failed.length) return;
          const back = ps.filter((p) => r.failed.some((f) => f.id === p.id));
          restore(back);
          toast(back.length === 1 ? `${r.failed[0].error} It's back in your library.` : `${back.length} couldn't be deleted, so they're back in your library. Try again in a moment.`, "error");
        },
        flush: () => keepaliveDelete("/api/posts/bulk", { ids }),
        restore: () => restore(ps),
        onFail: (e) => toast(e instanceof ApiError && e.status !== 0 ? `${e.message} Nothing was deleted.` : "Couldn't delete, so nothing changed. Check your connection and try again.", "error"),
      },
      ps.length === 1 ? "Deleted from your library." : `Deleted ${ps.length} posts.`,
    );
  };
  const confirmDelete = () => {
    if (del) deleteLater(del);
    setDel(null);
    clearSelection();
  };
  const copy = del ? bulkDeleteCopy(del) : null;
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !open && !stats && !del && clearSelection();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, open, stats, del]);

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
        <div className={cn("relative flex justify-center", posts.length >= 4 ? "mt-8 sm:-mt-10" : "mt-8")}>
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
            {filter === f.id && <motion.span layoutId="content-filter" className="bg-foreground absolute inset-0 rounded-full" transition={T.glide} />}
            <span className="relative">
              {f.label} <span className={cn("tabular", filter === f.id && "opacity-60")}>{counts[f.id]}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-60">
          <span className="sr-only">Search your content</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && query && (e.preventDefault(), clearSearch())}
            placeholder="Search titles, captions, tags, file names"
            maxLength={100}
            className="h-11 w-full rounded-full bg-secondary/60 pl-10 pr-11 text-sm text-foreground placeholder:text-muted-foreground hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))] [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={clearSearch} aria-label="Clear search" className="absolute right-0 top-0 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--ring))]">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </label>
        {list.length > 0 && (
          <Button variant={picking ? "primary" : "subtle"} className="min-h-[44px]" aria-pressed={picking} onClick={() => (picking ? clearSelection() : setSelecting(true))}>
            <ListChecks className="h-4 w-4" aria-hidden="true" /> {picking ? "Done" : "Select"}
          </Button>
        )}
      </div>
      <p className="sr-only" role="status">
        {q ? (remote?.loading ? "Searching…" : `${list.length} ${list.length === 1 ? "result" : "results"} for ${q}`) : ""}
      </p>

      {filter === "draft" && <DeviceDrafts className="mt-8" limit={8} heading="Also saved on this device" grid="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" />}

      {filter === "failed" && failedPosts.length > 1 && (
        <div className="mt-6 flex justify-end">
          <Button variant="danger" size="sm" className="min-h-[44px]" onClick={() => setDel(failedPosts)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete all {failedPosts.length} failed
          </Button>
        </div>
      )}

      {list.length === 0 && (loadingMore || remote?.loading) ? (
        <p className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {q ? "Searching…" : "Loading…"}
        </p>
      ) : list.length === 0 && q ? (
        <div className="mt-16 flex flex-col items-center text-center">
          <p className="text-2xl font-semibold tracking-tight">Nothing matches &ldquo;{q}&rdquo;.</p>
          <p className="mt-2 text-muted-foreground">{filter === "all" ? "Try another word, or part of a file name." : "Try another word, or look in All."}</p>
          {remote?.err && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {remote.err}
            </p>
          )}
          <Button variant="primary" className="mt-6" onClick={clearSearch}>
            <X className="h-4 w-4" aria-hidden="true" /> Clear search
          </Button>
        </div>
      ) : list.length === 0 ? (
        <Empty filter={filter} />
      ) : (
        <motion.ul layout className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          <AnimatePresence>
            {list.map((p, i) => (
              <motion.li key={p.id} className="group/card relative" layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.03, 0.3) } }} exit={{ opacity: 0, scale: 0.95 }}>
                <button
                  type="button"
                  onClick={(e) => (picking ? toggle(i, e.shiftKey) : hasLive(p) ? setStats(p) : setOpen(p))}
                  // While selecting, the checkbox is the control for keyboards and screen readers; a click on the card still picks it.
                  tabIndex={picking ? -1 : undefined}
                  className="group block w-full text-left"
                  aria-label={`${p.title ?? "Untitled"}, ${p.status}. ${hasLive(p) ? "Open analytics" : "Open details"}`}
                >
                  <div className={cn("relative aspect-[9/16] overflow-hidden rounded-[24px] hairline transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_30px_60px_-30px_hsl(var(--energy-b)/0.6)]", selected.has(p.id) && "ring-2 ring-foreground ring-offset-2 ring-offset-background")}>
                    <Thumb src={p.media.thumbnailUrl} video={p.media.kind === "image" ? null : p.media.url} alt="" className="absolute inset-0" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/30" />
                    <StatusBadge status={p.status} className={cn("absolute left-3", picking ? "top-[3.6rem]" : "top-3")} />
                    {p.media.duration ? <span className={cn("tabular absolute right-3 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white backdrop-blur", isFailedPost(p) ? "top-[3.6rem]" : "top-3")}>{formatDuration(p.media.duration)}</span> : null}
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
                {picking && (
                  <label className="absolute left-2 top-2 grid h-11 w-11 cursor-pointer place-items-center rounded-full bg-black/55 text-white backdrop-blur has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-white">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => toggle(i, !!(e.nativeEvent as MouseEvent).shiftKey)}
                      aria-label={`Select ${p.title ?? "Untitled idea"}`}
                      className="h-5 w-5 cursor-pointer accent-[hsl(var(--lime))]"
                    />
                  </label>
                )}
                {isFailedPost(p) && !picking && (
                  <button
                    type="button"
                    onClick={() => deleteLater([p])}
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

      {q && remote?.next && list.length > 0 && (
        <div className="mt-8 flex flex-col items-center gap-2">
          <Button variant="subtle" onClick={() => void searchPage(searchKey, remote.next)} disabled={remote.loading} className="min-h-[44px]">
            {remote.loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {remote.loading ? "Searching…" : "Show more results"}
          </Button>
          {remote.err && (
            <p role="alert" className="text-sm text-destructive">
              {remote.err}
            </p>
          )}
        </div>
      )}

      {!q && next && (shown.length > 0 || !loadingMore) && (
        <div className="mt-8 flex flex-col items-center gap-2">
          <Button variant="subtle" onClick={() => void loadMore()} disabled={loadingMore} className="min-h-[44px]">
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {loadingMore ? "Loading…" : filter === "all" ? `Show more (${Math.max(0, counts.all - posts.length)} more)` : `Show more (${Math.max(0, counts[filter] - shown.length)} more)`}
          </Button>
          {moreErr && (
            <p role="alert" className="text-sm text-destructive">
              {moreErr}
            </p>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div role="region" aria-label="Selected posts" className="sticky bottom-[calc(env(safe-area-inset-bottom)+82px)] z-30 mt-8 flex justify-center lg:bottom-6">
          <div className="glass-strong flex flex-wrap items-center justify-center gap-2 rounded-3xl p-2 pl-4 shadow-lg">
            <p className="tabular mr-1 text-sm font-semibold" aria-live="polite">
              {selected.size} selected
            </p>
            {!allVisibleSelected && (
              <Button variant="ghost" className="min-h-[44px]" onClick={() => setSelected((s) => new Set([...s, ...visibleIds]))}>
                Select all {visibleIds.length}
              </Button>
            )}
            <Button variant="ghost" className="min-h-[44px]" onClick={clearSelection}>
              Clear selection
            </Button>
            <Button variant="danger" className="min-h-[44px]" onClick={() => setDel([...posts, ...(found?.posts ?? [])].filter((p, i, a) => selected.has(p.id) && a.findIndex((x) => x.id === p.id) === i))}>
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete {selected.size}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={copy?.title ?? ""} body={copy?.body ?? ""} confirmLabel={copy?.confirm ?? "Delete"} onConfirm={confirmDelete} />

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
          setFound((f) => (f ? { ...f, posts: f.posts.map((x) => (x.id === np.id ? np : x)) } : f));
          setOpen(np);
        }}
        onRemove={(id) => {
          setPosts((ps) => ps.filter((x) => x.id !== id));
          setFound((f) => (f ? { ...f, posts: f.posts.filter((x) => x.id !== id) } : f));
        }}
        onRestore={(p) => {
          // Newest edit first, as the server sorts them.
          const at = (xs: PostView[]) => {
            const i = xs.findIndex((x) => x.updatedAt <= p.updatedAt);
            return i < 0 ? xs.length : i;
          };
          setPosts((ps) => reinsert(ps, p, at(ps)));
          setFound((f) => (f && matchesQuery(p, q) ? { ...f, posts: reinsert(f.posts, p, at(f.posts)) } : f));
        }}
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
