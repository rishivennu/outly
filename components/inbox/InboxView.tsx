"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, ArrowLeft, Check, ExternalLink, Image as ImageIcon, Lightbulb, Link2, Mail, MailOpen, MessagesSquare, Play, RefreshCw, Search, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { targetErrorCopy } from "@/components/shared/errorCopy";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { cn } from "@/lib/utils";
import { useTabMemory } from "@/lib/client/tab-state";
import { takeDeepLink } from "@/lib/client/deep-link";
import { useFresh } from "@/components/shell/PageFresh";
import type { InboxComment, InboxProblem } from "@/lib/inbox";
import { MessagesView, threadsWaiting, type DmData } from "./MessagesView";
import { hasPreview, usePreview, VideoPreview } from "./VideoPreview";
import { ago, ConnectionStrip, InboxRow, InboxTabs, isTyping, isWide, joinNames, Kbd, PersonAvatar, ScopeBar, stripButton, Tag, useMobileLock, type InboxTab, type PaneProps, type ScopeView } from "./InboxList";

/** platforms (Phase 2): connected platforms whose API lists comments, for the filter chips. */
type Data = { comments: InboxComment[]; errors: InboxProblem[]; targets: number; platforms?: Platform[] };

/**
 * 1093: the inbox as a mail client. One compact header, one connection strip, a dense list on the left and the open
 * comment or conversation on the right (full screen on a phone). Messages (1031) are the second tab.
 */
export function InboxView({ initial, dms, initialTab = "comments", renderedAt, readOnly = false }: { initial: Data; dms?: DmData; initialTab?: InboxTab; renderedAt?: number; readOnly?: boolean }) {
  // 1114: with no ?tab= in the link (the tab bar's), Comments or Messages as you left them.
  const params = useSearchParams();
  const keptTab = useTabMemory<InboxTab>("inbox:tab", (v) => (v === "messages" || v === "comments" ? v : null));
  // A notification about one comment (?comment=) always opens on Comments, whatever tab was kept.
  const restoredTab = dms && !params?.get("tab") && !params?.get("comment") && keptTab.saved === "messages" ? "messages" : null;
  const [tab, setTab] = useState<InboxTab>(restoredTab ?? (dms ? initialTab : "comments"));
  const { save: saveTab } = keptTab;
  useEffect(() => saveTab(tab), [tab, saveTab]);
  useEffect(() => {
    if (restoredTab) {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", "messages");
      window.history.replaceState(null, "", u.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pickTab = (t: InboxTab) => {
    setTab(t);
    const u = new URL(window.location.href);
    if (t === "messages") u.searchParams.set("tab", "messages");
    else u.searchParams.delete("tab");
    window.history.replaceState(null, "", u.toString());
  };
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const [tick, setTick] = useState({ n: 0, quiet: false });
  const refreshTick = tick.n;
  const setRefreshTick = (f: (n: number) => number) => setTick((t) => ({ n: f(t.n), quiet: false }));
  // 1114: opened from the background preload a minute or more after it was loaded: fetch the latest quietly, the way
  // the refresh button does (the list stays on screen meanwhile).
  useFresh(renderedAt, 60_000, () => setTick((t) => ({ n: t.n + 1, quiet: true })));
  const [busy, setBusy] = useState(false);
  // The tab that isn't mounted keeps the count it last had; at first that is worked out from the page's data.
  const [waiting, setWaiting] = useState<Record<InboxTab, number>>(() => ({ comments: commentsWaiting(initial.comments), messages: dms ? threadsWaiting(dms.threads) : 0 }));
  const onWaitComments = useCallback((n: number) => setWaiting((w) => (w.comments === n ? w : { ...w, comments: n })), []);
  const onWaitMessages = useCallback((n: number) => setWaiting((w) => (w.messages === n ? w : { ...w, messages: n })), []);
  const total = waiting.comments + (dms ? waiting.messages : 0);

  // "/" jumps to search from anywhere on the page, like every mail client.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (!isWide() && document.querySelector("[data-inbox-detail]")) return; // the header search is under the open item
      e.preventDefault();
      setSearchOpen(true);
      requestAnimationFrame(() => search.current?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tabs = dms ? <InboxTabs tab={tab} onPick={pickTab} counts={waiting} /> : null;
  const pane: PaneProps = { tabs, query, refreshTick, refreshQuiet: tick.quiet, onBusy: setBusy, onWaiting: tab === "messages" ? onWaitMessages : onWaitComments };

  return (
    <div className="flex flex-col gap-3 px-4 pt-3 sm:px-6 lg:h-[100dvh] lg:min-h-[560px] lg:px-6 lg:pb-5 lg:pt-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-[26px] font-bold leading-none tracking-[-0.02em] lg:text-[30px]">Inbox</h1>
        <p className="min-w-0 truncate pt-1 text-[13px] text-muted-foreground" aria-live="polite">
          {total > 0 ? (
            <>
              <span className="font-semibold text-foreground">{total} waiting</span>
              <span className="hidden sm:inline"> for a reply</span>
            </>
          ) : (
            "All caught up"
          )}
        </p>
        <span className="flex-1" />
        <label className={cn("relative order-last w-full lg:order-none lg:block lg:w-[300px]", searchOpen ? "block" : "hidden")}>
          <span className="sr-only">Search the inbox</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                setSearchOpen(false);
                e.currentTarget.blur();
              }
            }}
            placeholder="Search people and comments"
            className="h-11 w-full rounded-xl bg-card pl-9 pr-10 text-[16px] text-foreground placeholder:text-muted-foreground hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring lg:h-10 lg:text-[14px]"
          />
          <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 lg:block">
            <Kbd>/</Kbd>
          </span>
        </label>
        <Button variant="ghost" size="icon" onClick={() => setSearchOpen((v) => !v)} aria-label={searchOpen ? "Close search" : "Search the inbox"} aria-expanded={searchOpen} className="text-foreground lg:hidden">
          {searchOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Search className="h-5 w-5" aria-hidden="true" />}
        </Button>
        <Button variant="outline" onClick={() => setRefreshTick((n) => n + 1)} disabled={busy} aria-label={busy ? "Checking for new comments and messages" : "Refresh"} className="h-11 w-11 px-0 lg:w-auto lg:rounded-xl lg:px-4">
          <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden="true" />
          <span className="hidden lg:inline">{busy ? "Checking…" : "Refresh"}</span>
        </Button>
      </header>

      {tab === "messages" && dms ? <MessagesView key="messages" initial={dms} {...pane} /> : <CommentsPane key="comments" initial={initial} hasTabs={!!dms} readOnly={readOnly} {...pane} />}
    </div>
  );
}

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/^@+/, "").toLowerCase();

/** The creator's own handles, as the platforms print them. A reply from one of these means the comment is answered. */
function ownNames(comments: InboxComment[]) {
  const s = new Set<string>();
  for (const c of comments) if (c.media?.account) s.add(norm(c.media.account));
  return s;
}
const hasOwnReply = (c: InboxComment, mine: Set<string>) => (c.replies ?? []).some((r) => mine.has(norm(r.authorName)));
/** The creator's own comment under their post: nothing to answer. */
const isOwn = (c: InboxComment, mine: Set<string>) => mine.has(norm(c.authorName));
function commentsWaiting(comments: InboxComment[]) {
  const mine = ownNames(comments);
  return comments.filter((c) => !c.archived && !hasOwnReply(c, mine) && !isOwn(c, mine)).length;
}

/** Phase 2: the four views of the filter row. Archived ones only show under Archived. */
export type CommentView = "reply" | "unread" | "all" | "archived";
export const COMMENT_VIEWS: readonly CommentView[] = ["reply", "unread", "all", "archived"];
const VIEW_LABEL: Record<CommentView, string> = { reply: "Needs reply", unread: "Unread", all: "All", archived: "Archived" };

/** Marked by hand wins; a comment never opened is unread until it is answered. */
export const isUnread = (c: Pick<InboxComment, "read">, replied: boolean) => c.read === "unread" || (c.read === null && !replied);

export function inView(view: CommentView, c: Pick<InboxComment, "read" | "archived">, replied: boolean) {
  if (view === "archived") return c.archived;
  if (c.archived) return false;
  if (view === "reply") return !replied;
  if (view === "unread") return isUnread(c, replied);
  return true;
}

/** Search covers who, what they said, the post it is on and the platform's name. */
export function matchesQuery(c: Pick<InboxComment, "authorName" | "text" | "postTitle" | "platform">, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return `${c.authorName} ${c.text} ${c.postTitle ?? ""} ${PLATFORM_META[c.platform]?.name ?? ""}`.toLowerCase().includes(s);
}

/** Rows drawn at a time; "Show more" adds the next batch, so a busy account never renders thousands at once. */
export const COMMENT_PAGE = 40;
/** The state route takes at most 100 at a time. */
export const STATE_BATCH = 100;

export function keptView(v: unknown): { platform: Platform | "all"; view: CommentView } | null {
  const o = v as { platform?: unknown; view?: unknown; needsOnly?: unknown } | null;
  if (!o || typeof o !== "object") return null;
  const platform = o.platform === "all" || (typeof o.platform === "string" && o.platform in PLATFORM_META) ? (o.platform as Platform | "all") : null;
  if (!platform) return null;
  if (typeof o.view === "string" && (COMMENT_VIEWS as readonly string[]).includes(o.view)) return { platform, view: o.view as CommentView };
  // Kept before Phase 2: "Needs reply" or "All".
  if (typeof o.needsOnly === "boolean") return { platform, view: o.needsOnly ? "reply" : "all" };
  return null;
}
const keyOf = (c: Pick<InboxComment, "targetId" | "id">) => `${c.targetId}-${c.id}`;
const titleOf = (c: InboxComment) => c.postTitle ?? "a post";

function CommentsPane({ initial, hasTabs, readOnly, tabs, query, refreshTick, refreshQuiet, onBusy, onWaiting }: PaneProps & { initial: Data; hasTabs: boolean; readOnly: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<Data>(initial);
  // 1114: the platform and view filters as you left them (kept per account, for half an hour).
  const kept = useTabMemory<{ platform: Platform | "all"; view: CommentView }>("inbox:comments", keptView);
  const [platform, setPlatform] = useState<Platform | "all">(kept.saved?.platform ?? "all");
  const live = useLivePlatforms();
  // Phase 2: chips only for connected platforms whose API lists comments (the server says which).
  const chipPlatforms = data.platforms ?? live;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<CommentView>(kept.saved?.view ?? "reply");
  const [limit, setLimit] = useState(COMMENT_PAGE);
  const [deepMissing, setDeepMissing] = useState(false);
  // 1114: a newer server render (a profile switch, a refresh) replaces the list, unless a platform filter loaded its own.
  const [given, setGiven] = useState(initial);
  if (initial !== given) {
    setGiven(initial);
    if (platform === "all") setData(initial);
  }
  const { save: saveFilters } = kept;
  useEffect(() => saveFilters({ platform, view }), [platform, view, saveFilters]);
  useEffect(() => setLimit(COMMENT_PAGE), [platform, view, query]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // 1136: opened from a notification about one comment (/inbox?comment=<id>&target=<id>). The comment is
  // only in the list once the platform has been read again, so the automatic "open the first one" below
  // stands aside for a few seconds rather than snatching the pane away from the one that was asked for.
  const deep = useRef<{ key: string; at: number } | null>(null);
  useEffect(() => {
    const link = takeDeepLink(["comment", "target"]);
    if (!link) return;
    const key = `${link.target}-${link.comment}`;
    deep.current = { key, at: Date.now() };
    setOpenKey(key);
    // Phase 2: a kept platform filter must not hide the comment the notification is about.
    setPlatform("all");
    const t = setTimeout(() => {
      if (deep.current?.key === key) {
        deep.current = null;
        setDeepMissing(true);
      }
    }, 9_000);
    return () => clearTimeout(t);
  }, []);
  // Answered from here this visit, even when the platform's copy of the reply hasn't come back yet.
  const [answered, setAnswered] = useState<Set<string>>(() => new Set());
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const preview = usePreview();

  const mine = useMemo(() => ownNames(data.comments), [data.comments]);
  const replied = useCallback((c: InboxComment) => answered.has(keyOf(c)) || hasOwnReply(c, mine) || isOwn(c, mine), [answered, mine]);
  const waitingList = data.comments.filter((c) => !c.archived && !replied(c));
  const unreadCount = data.comments.filter((c) => !c.archived && isUnread(c, replied(c))).length;
  const archivedCount = data.comments.filter((c) => c.archived).length;
  useEffect(() => onWaiting(waitingList.length), [waitingList.length, onWaiting]);
  useEffect(() => onBusy(loading), [loading, onBusy]);

  const q = query.trim().toLowerCase();
  // The open comment stays in the list after it is answered, read or archived, so it doesn't vanish under you.
  const visible = data.comments.filter((c) => (inView(view, c, replied(c)) || keyOf(c) === openKey) && matchesQuery(c, q));
  const shown = visible.slice(0, limit);
  const open = data.comments.find((c) => keyOf(c) === openKey) ?? null;
  const views: ScopeView[] = COMMENT_VIEWS.map((v) => ({ id: v, label: VIEW_LABEL[v], count: v === "reply" ? waitingList.length : v === "unread" ? unreadCount : undefined }));

  // Phase 2: read / unread / archive, stored in Outlly only. Shown at once, put back if the server says no.
  const patchState = useCallback(
    async (list: InboxComment[], patch: { read?: boolean; archived?: boolean }, quiet = false) => {
      if (!list.length) return true;
      const before = new Map(list.map((c) => [keyOf(c), { read: c.read, archived: c.archived }]));
      const next = (c: InboxComment): InboxComment => ({ ...c, ...(patch.read !== undefined ? { read: patch.read ? "read" : "unread" } : {}), ...(patch.archived !== undefined ? { archived: patch.archived } : {}) });
      setData((d) => ({ ...d, comments: d.comments.map((c) => (before.has(keyOf(c)) ? next(c) : c)) }));
      try {
        for (let i = 0; i < list.length; i += STATE_BATCH) {
          const items = list.slice(i, i + STATE_BATCH).map((c) => ({ accountId: c.accountId, itemId: c.id }));
          await api("/api/inbox/state", { method: "PATCH", json: { items, ...patch } });
        }
        return true;
      } catch (e) {
        setData((d) => ({ ...d, comments: d.comments.map((c) => (before.has(keyOf(c)) ? { ...c, ...before.get(keyOf(c))! } : c)) }));
        if (!quiet || !(e instanceof ApiError && e.status === 429)) toast(e instanceof ApiError ? e.message : "That didn't save. Check your connection and try again.", "error");
        return false;
      }
    },
    [toast],
  );
  const markRead = useCallback((c: InboxComment | null | undefined) => {
    if (c && isUnread(c, replied(c))) void patchState([c], { read: true }, true);
  }, [patchState, replied]);
  const toggleRead = (c: InboxComment) => {
    const unread = isUnread(c, replied(c));
    void patchState([c], { read: unread }).then((ok) => ok && toast(unread ? "Marked as read." : "Marked as unread.", "ok"));
  };
  const toggleArchive = (c: InboxComment) => {
    const archive = !c.archived;
    void patchState([c], { archived: archive }).then((ok) => {
      if (!ok) return;
      toast(archive ? "Archived. It only leaves your Outlly inbox; it stays on the platform." : "Moved back to the inbox.", "ok", { action: { label: "Undo", onClick: () => void patchState([c], { archived: !archive }) } });
    });
  };
  const markAllRead = () => {
    const list = visible.filter((c) => !c.archived && isUnread(c, replied(c)));
    void patchState(list, { read: true }).then((ok) => ok && toast(`${list.length} marked as read.`, "ok"));
  };

  const seq = useRef(0);
  // 1114: when the last load started and whether it is still out, so the freshness pass never repeats one.
  const lastLoad = useRef({ at: 0, out: false });
  const load = async (p: Platform | "all") => {
    const mineSeq = ++seq.current;
    lastLoad.current = { at: Date.now(), out: true };
    setPlatform(p);
    setLoading(true);
    setError(null);
    try {
      const next = await api<Data>(`/api/inbox${p === "all" ? "" : `?platform=${p}`}`);
      if (mineSeq === seq.current) setData(next);
    } catch (e) {
      if (mineSeq === seq.current) setError(e instanceof ApiError ? e.message : "We couldn't reach your comments just now.");
    } finally {
      if (mineSeq === seq.current) {
        setLoading(false);
        lastLoad.current.out = false;
      }
    }
  };
  const loadRef = useRef(load);
  loadRef.current = load;
  const firstTick = useRef(refreshTick);
  useEffect(() => {
    const l = lastLoad.current;
    if (refreshTick === firstTick.current) return;
    // The quiet pass right after a load (the kept filter's, on opening) would only fetch the same thing again.
    if (refreshQuiet && (l.out || Date.now() - l.at < 5_000)) return;
    void loadRef.current(platform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);
  // The page arrives with every platform's comments; a kept platform filter loads its own.
  useEffect(() => {
    if (kept.saved && kept.saved.platform !== "all" && !deep.current) void loadRef.current(kept.saved.platform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Side by side, the right side is never blank: open the first comment. On a phone the list comes first.
  const firstKey = visible[0] ? keyOf(visible[0]) : null;
  useEffect(() => {
    if (deep.current && (open ? keyOf(open) === deep.current.key : Date.now() - deep.current.at < 8_000)) {
      if (open) {
        deep.current = null; // the asked-for comment arrived
        markRead(open);
      }
      return;
    }
    if (!open && firstKey && isWide()) setOpenKey(firstKey);
  }, [open, firstKey]);

  // Opened by the creator (a tap, J / K): that counts as read. The automatic first pick on a wide screen does not.
  const openByUser = useCallback(
    (k: string) => {
      setOpenKey(k);
      markRead(data.comments.find((c) => keyOf(c) === k));
    },
    [data.comments, markRead],
  );
  const go = useCallback((k: string) => {
    openByUser(k);
    requestAnimationFrame(() => rows.current.get(k)?.focus());
  }, [openByUser]);

  // J / K walk the list; Escape closes the full-screen comment on a phone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && open && !isWide() && !preview.open) {
        // In the reply box, the first Escape only leaves the box; the draft stays.
        if (isTyping(e.target)) {
          (e.target as HTMLElement).blur();
          return;
        }
        setOpenKey(null);
        return;
      }
      if (isTyping(e.target) || (e.key !== "j" && e.key !== "k") || !visible.length) return;
      const i = visible.findIndex((c) => keyOf(c) === openKey);
      const next = e.key === "j" ? Math.min(visible.length - 1, i + 1) : Math.max(0, i - 1);
      e.preventDefault();
      if (next >= limit) setLimit((n) => n + COMMENT_PAGE);
      go(keyOf(visible[next]));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, openKey, open, go, preview.open, limit]);

  useMobileLock(!!open);

  const onReplied = (c: InboxComment, reply: InboxComment) => {
    setData((d) => ({ ...d, comments: d.comments.map((x) => (keyOf(x) === keyOf(c) ? { ...x, replies: [...(x.replies ?? []), reply] } : x)) }));
    setAnswered((s) => new Set(s).add(keyOf(c)));
    setData((d) => ({ ...d, comments: d.comments.map((x) => (keyOf(x) === keyOf(c) ? { ...x, read: "read" } : x)) }));
    toast("Reply sent.");
  };

  const pos = open ? waitingList.findIndex((c) => keyOf(c) === keyOf(open)) : -1;

  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {data.errors.length > 0 && <CommentProblems errors={data.errors} busy={loading} onRetry={() => void load(platform)} />}

      <div className="-mx-4 min-h-0 flex-1 sm:-mx-6 lg:mx-0 lg:grid lg:grid-cols-[minmax(320px,400px)_1fr] lg:overflow-hidden lg:rounded-[24px] lg:bg-card lg:hairline card-glass card-glass-desk">
        <section aria-label="Comments" className="flex min-h-0 flex-col lg:border-r lg:border-border">
          <div className="px-4 pb-2 sm:px-6 lg:px-3 lg:pt-3">
            {tabs}
            <ScopeBar views={views} view={view} onView={(v) => setView(v as CommentView)} chips platforms={chipPlatforms} platform={platform} onPlatform={(p) => void load(p)} />
          </div>
          <div role={hasTabs ? "tabpanel" : undefined} id="inbox-panel-comments" aria-labelledby={hasTabs ? "inbox-tab-comments" : undefined} aria-busy={loading} className="min-h-0 flex-1 border-t border-border/70 lg:overflow-y-auto lg:overscroll-contain">
            {deepMissing && (
              <p role="status" className="flex items-start gap-2 border-b border-border/70 px-4 py-3 text-[13px] text-muted-foreground">
                <span className="min-w-0 flex-1">That comment isn&apos;t on the platform any more, or it hasn&apos;t come through yet. Refresh in a minute to check again.</span>
                <button type="button" onClick={() => setDeepMissing(false)} aria-label="Hide this note" className="-my-2 grid h-11 w-11 shrink-0 place-items-center rounded-full [@media(hover:hover)]:hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </p>
            )}
            {data.comments.length === 0 ? (
              <div className="p-10 text-center">
                <MessagesSquare className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
                <p className="mt-3 font-medium">{data.targets === 0 ? "No comments to show yet." : "No comments yet."}</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">{data.targets === 0 ? "Connect an account on the Accounts page and comments on your recent posts land here." : "We checked your recent posts on every connected account. Give it time."}</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="p-10 text-center">
                {view === "archived" && !q ? <Archive className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" /> : <Check className="mx-auto h-7 w-7 text-lime-ink" aria-hidden="true" />}
                <p className="mt-3 font-medium">{q ? "Nothing matches that search." : view === "archived" ? "Nothing archived." : view === "unread" ? "No unread comments." : view === "reply" ? "You've answered everyone." : "No comments here."}</p>
                {!q && view === "archived" && <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">Archive a comment to clear it from your inbox. It stays on the platform.</p>}
                {!q && (view === "reply" || view === "unread") && (
                  <button type="button" onClick={() => setView("all")} className="mt-2 min-h-[44px] rounded-full px-4 text-sm font-medium underline [@media(hover:hover)]:hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    Show all comments
                  </button>
                )}
              </div>
            ) : (
              <>
                {view === "unread" && unreadCount > 0 && (
                  <div className="flex items-center gap-2 border-b border-border/70 px-4 py-1 text-[13px] text-muted-foreground">
                    <span className="tabular-nums">{unreadCount} unread</span>
                    <button type="button" onClick={markAllRead} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-medium text-foreground [@media(hover:hover)]:hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:scale-[0.96]">
                      <MailOpen className="h-4 w-4" aria-hidden="true" /> Mark all as read
                    </button>
                  </div>
                )}
                <ul aria-label={`${VIEW_LABEL[view]} comments`}>
                  {shown.map((c) => {
                    const k = keyOf(c);
                    const done = replied(c);
                    const unread = !c.archived && isUnread(c, done);
                    const pname = PLATFORM_META[c.platform].name;
                    return (
                      <InboxRow
                        key={k}
                        id={`row-${k}`}
                        ref={(el) => {
                          if (el) rows.current.set(k, el);
                          else rows.current.delete(k);
                        }}
                        selected={k === openKey}
                        needsReply={!done}
                        unread={unread}
                        name={c.authorName}
                        avatar={<PersonAvatar name={c.authorName} platform={c.platform} />}
                        tag={c.practice ? <Tag>Practice</Tag> : c.archived ? <Tag>Archived</Tag> : c.text.includes("?") ? <Tag tone="question">Question</Tag> : null}
                        time={ago(c.createdAt)}
                        preview={c.text}
                        context={
                          done ? (
                            <>
                              <Check className="h-3.5 w-3.5 shrink-0 text-lime-ink" aria-hidden="true" />
                              <span className="shrink-0 font-medium text-lime-ink">{isOwn(c, mine) ? "Your comment" : "Replied"}</span>
                              <span className="truncate">
                                · {pname} · on {titleOf(c)}
                              </span>
                            </>
                          ) : (
                            <span className="truncate">
                              {pname} · on {titleOf(c)}
                            </span>
                          )
                        }
                        label={`${c.authorName} on ${pname}, ${unread ? "unread, " : ""}${done ? "replied" : "needs a reply"}, on ${titleOf(c)}: ${c.text.slice(0, 90)}`}
                        onOpen={() => openByUser(k)}
                      />
                    );
                  })}
                </ul>
                {visible.length > shown.length && (
                  <div className="p-3 text-center">
                    <button type="button" onClick={() => setLimit((n) => n + COMMENT_PAGE)} className="inline-flex min-h-11 items-center rounded-full bg-card px-5 text-sm font-medium text-foreground hairline [@media(hover:hover)]:hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:scale-[0.96]">
                      Show more <span className="ml-1 tabular-nums text-muted-foreground">({visible.length - shown.length} left)</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          <footer className="hidden items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground lg:flex">
            <span>
              <Kbd>J</Kbd>
              <Kbd>K</Kbd> move
            </span>
            <span>
              <Kbd>/</Kbd> search
            </span>
            <span className="ml-auto tabular-nums">
              {waitingList.length} of {data.comments.length - archivedCount} need a reply{archivedCount ? ` · ${archivedCount} archived` : ""}
            </span>
          </footer>
        </section>

        <div data-inbox-detail={open ? "" : undefined} className={cn("min-h-0 min-w-0 flex-col", open ? "fixed inset-0 z-[60] flex bg-background lg:static lg:z-auto lg:bg-transparent" : "hidden lg:flex")}>
          {open ? (
            <CommentDetail
              key={keyOf(open)}
              comment={open}
              replied={replied(open)}
              mine={mine}
              readOnly={readOnly}
              position={pos >= 0 ? `${pos + 1} of ${waitingList.length} waiting` : null}
              unread={!open.archived && isUnread(open, replied(open))}
              onToggleRead={() => toggleRead(open)}
              onToggleArchive={() => toggleArchive(open)}
              onBack={() => {
                const k = keyOf(open);
                setOpenKey(null);
                requestAnimationFrame(() => rows.current.get(k)?.focus());
              }}
              onReplied={onReplied}
              onPreview={(from) => preview.show(open, from)}
            />
          ) : (
            <div className="grid h-full place-items-center p-10 text-center text-sm text-muted-foreground">Pick a comment to read and answer it.</div>
          )}
        </div>
      </div>
      <VideoPreview state={preview.open} all={data.comments} onSelect={preview.select} onClose={preview.close} onClosed={preview.restore} />
    </>
  );
}

/** Inbox copy for a platform that didn't hand comments over. The upload wording ("didn't like the video") is wrong here. */
export function inboxReason(platform: Platform, code: string) {
  const n = PLATFORM_META[platform].name;
  switch (code) {
    case "AUTH_EXPIRED":
    case "NOT_CONNECTED":
      return `${n} signed Outlly out. Reconnect it to bring new comments in.`;
    case "RATE_LIMITED":
      return `${n} asked us to slow down. Try again in a minute.`;
    case "MEDIA_REJECTED":
      return `${n} wouldn't share comments for this post. It may have been deleted, archived or made private.`;
    case "FORBIDDEN":
      return `${n} isn't letting Outlly read these comments yet.`;
    case "NETWORK":
    case "PLATFORM_DOWN":
      return `We couldn't reach ${n}. Try again in a minute.`;
    default:
      return `${n} didn't send these comments back.`;
  }
}

/** The strip's headline: what is missing, in one sentence, without making the creator decode an error. */
export function problemHeadline(errors: InboxProblem[]) {
  const reconnect = Array.from(new Set(errors.filter((e) => e.code === "AUTH_EXPIRED" || e.code === "NOT_CONNECTED").map((e) => e.platform)));
  const rest = errors.filter((e) => !reconnect.includes(e.platform));
  const posts = (list: InboxProblem[]) => new Set(list.map((e) => e.targetId)).size;
  const names = (list: InboxProblem[]) => joinNames(Array.from(new Set(list.map((e) => e.platform))).map((p) => PLATFORM_META[p].name));
  if (reconnect.length) {
    const title = `Reconnect ${joinNames(reconnect.map((p) => PLATFORM_META[p].name))} to get new comments.`;
    const n = posts(rest);
    return { title, body: n ? `Comments on ${n} other ${n === 1 ? "post" : "posts"} didn't load either.` : "Everything else here is up to date.", reconnect, retry: n > 0 };
  }
  const n = posts(rest);
  const title = rest.every((e) => !e.postTitle) ? `Some ${names(rest)} comments didn't load.` : `Comments on ${n} ${names(rest)} ${n === 1 ? "post" : "posts"} didn't load.`;
  return { title, body: "Everything else here is up to date.", reconnect, retry: true };
}

function CommentProblems({ errors, busy, onRetry }: { errors: InboxProblem[]; busy: boolean; onRetry: () => void }) {
  const [more, setMore] = useState(false);
  const groups = groupProblems(errors);
  const head = problemHeadline(errors);
  // Hidden for this visit only, and only for this exact set of problems: a new one shows the strip again.
  const sig = errors.map((e) => `${e.platform}:${e.code}:${e.targetId}`).sort().join("|");
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem("outlly:inbox-notice") === sig);
    } catch {}
  }, [sig]);
  if (hidden) return null;
  const hide = () => {
    try {
      sessionStorage.setItem("outlly:inbox-notice", sig);
    } catch {}
    setHidden(true);
  };
  return (
    <ConnectionStrip
      title={head.title}
      body={head.body}
      actions={
        <>
          {head.reconnect.map((p) => (
            <a key={p} href={`/api/accounts/${p}/connect?returnTo=${encodeURIComponent("/inbox")}`} className={cn(stripButton, "hidden sm:inline-flex")}>
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Reconnect {PLATFORM_META[p].name}
            </a>
          ))}
          {head.retry && (
            <button type="button" onClick={onRetry} disabled={busy} className={cn(stripButton, "disabled:opacity-60")}>
              <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} aria-hidden="true" /> {busy ? "Trying…" : "Try again"}
            </button>
          )}
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} aria-controls="inbox-problems" className={stripButton}>
            {more ? "Hide details" : head.reconnect.length ? <><span className="sm:hidden">Fix</span><span className="hidden sm:inline">Details</span></> : "Details"}
          </button>
          <button type="button" onClick={hide} aria-label="Hide this notice" title="Hide this notice" className={cn(stripButton, "w-11 justify-center px-0 lg:w-9")}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      }
      details={
        more && (
          <ul id="inbox-problems" className="mt-3 space-y-3 border-t border-warning/20 pt-3">
            {groups.map((g) => {
              const copy = targetErrorCopy(g.platform, g.code);
              const where = g.items.length === 1 ? g.items[0].postTitle ?? `Your ${PLATFORM_META[g.platform].name} account` : `${g.items.length} ${PLATFORM_META[g.platform].name} posts`;
              const titles = g.items.map((e) => e.postTitle).filter(Boolean) as string[];
              const details = Array.from(new Set(g.items.map((e) => e.detail).filter(Boolean))) as string[];
              return (
                <li key={`${g.platform}-${g.code}`}>
                  <p className="flex min-w-0 items-center gap-2 font-medium">
                    <PlatformOrb platform={g.platform} size={16} />
                    <span className="truncate">{where}</span>
                  </p>
                  <p className="mt-0.5 text-foreground/80">{inboxReason(g.platform, g.code)}</p>
                  {g.items[0].hint && <p className="mt-1 text-foreground/85">{g.items[0].hint}</p>}
                  {copy.kind === "reconnect" && (
                    <a href={`/api/accounts/${g.platform}/connect?returnTo=${encodeURIComponent("/inbox")}`} className="mt-2 inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background transition-transform active:scale-[0.97]">
                      <Link2 className="h-4 w-4" aria-hidden="true" /> {copy.action}
                    </a>
                  )}
                  {(g.items.length > 1 || details.length > 0) && (
                    <details className="mt-1">
                      <summary className="cursor-pointer py-1 text-xs text-muted-foreground">{g.items.length > 1 ? "Which posts" : "What the platform said"}</summary>
                      {g.items.length > 1 && (
                        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                          {Array.from(new Set(titles)).map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      )}
                      {details.map((d) => (
                        <pre key={d} className="mt-1 whitespace-pre-wrap break-all text-xs text-muted-foreground">
                          {d}
                        </pre>
                      ))}
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )
      }
    />
  );
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** The reel this comment is on (1052), big enough to recognise. Opens the preview in place. */
function ReelCard({ comment, onOpen }: { comment: InboxComment; onOpen: (from: string) => void }) {
  const m = comment.media;
  const [broken, setBroken] = useState(false);
  const id = `pv-${keyOf(comment)}`;
  const posted = m?.postedAt ? new Date(m.postedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
  if (!m || !hasPreview(comment))
    return (
      <div className="flex items-center gap-3 text-[13px] text-muted-foreground lg:w-[168px] lg:shrink-0 lg:flex-col lg:items-start">
        <PlatformOrb platform={comment.platform} size={32} />
        <p>
          On <span className="font-medium text-foreground">{titleOf(comment)}</span>
        </p>
      </div>
    );
  return (
    <div className="flex items-center gap-3 lg:block lg:w-[168px] lg:shrink-0">
      <button
        type="button"
        id={id}
        onClick={() => onOpen(id)}
        aria-haspopup="dialog"
        aria-label={`Preview ${m.kind === "image" ? "the photo" : "the video"}: ${titleOf(comment)}`}
        className="group relative aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-xl bg-secondary hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:w-full lg:rounded-[18px]"
      >
        {m.thumbnailUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
        ) : (
          <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-secondary to-muted" />
        )}
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm lg:h-11 lg:w-11">
            {m.kind === "image" ? <ImageIcon className="h-3.5 w-3.5 lg:h-5 lg:w-5" /> : <Play className="ml-0.5 h-3.5 w-3.5 lg:h-5 lg:w-5" fill="currentColor" />}
          </span>
        </span>
        <span aria-hidden="true" className="absolute inset-x-2.5 bottom-2.5 hidden text-left text-[13px] font-semibold leading-tight text-white lg:line-clamp-2">
          {titleOf(comment)}
        </span>
      </button>
      <div className="min-w-0 text-[13px] leading-relaxed text-muted-foreground lg:mt-2.5">
        <p className="font-medium text-foreground lg:hidden">{titleOf(comment)}</p>
        {posted && <p>Posted {posted}</p>}
        {m.account && <p className="truncate">{m.account}</p>}
        <p className="hidden lg:block">Tap to watch it here</p>
      </div>
    </div>
  );
}

function CommentDetail({
  comment,
  replied,
  mine,
  readOnly,
  position,
  unread,
  onToggleRead,
  onToggleArchive,
  onBack,
  onReplied,
  onPreview,
}: {
  comment: InboxComment;
  replied: boolean;
  mine: Set<string>;
  readOnly: boolean;
  position: string | null;
  unread: boolean;
  onToggleRead: () => void;
  onToggleArchive: () => void;
  onBack: () => void;
  onReplied: (c: InboxComment, reply: InboxComment) => void;
  onPreview: (from: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Phase 2: sending / sent / failed, said in words next to the box. A platform rate limit holds the button until it passes.
  const [sendState, setSendState] = useState<"idle" | "sent" | "failed">("idle");
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (waitUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waitUntil]);
  const waitLeft = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  const [left, setLeft] = useState<number | null>(null);
  const [ideas, setIdeas] = useState<{ label: string; text: string }[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const pname = PLATFORM_META[comment.platform].name;
  const lockId = `comment-lock-${comment.targetId}-${comment.id}`;
  const first = comment.authorName.replace(/^@/, "").split(/\s+/)[0];

  // A question in the comments is often the next video. Keep it in the idea bank on Home.
  const saveIdea = async () => {
    try {
      const r = await api<{ existed?: boolean }>("/api/ideas", { method: "POST", json: { text: `Answer ${comment.authorName}: ${comment.text}`.slice(0, 500), source: "comment", sourceRef: `${comment.platform}:${comment.id}`.slice(0, 300) } });
      setSaved(true);
      toast(r.existed ? "Already in your idea bank" : "Saved to your idea bank on Home", "ok");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't save it. Check your connection and try again.", "error");
    }
  };

  const suggest = async () => {
    if (readOnly) return;
    setThinking(true);
    setErr(null);
    try {
      const r = await api<{ suggestions: { label: string; text: string }[] }>("/api/ai/replies", {
        method: "POST",
        json: { comment: comment.text, author: comment.authorName, platform: comment.platform, postTitle: comment.postTitle ?? null },
      });
      setIdeas(r.suggestions);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Couldn't think of replies just now. Try again in a moment.");
    } finally {
      setThinking(false);
    }
  };

  const pick = (t: string) => {
    setText(t);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(t.length, t.length);
    });
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    void deliver();
  };
  const deliver = async () => {
    if (readOnly || !text.trim() || busy) return;
    if (!comment.canReply || waitLeft > 0) return;
    setBusy(true);
    setErr(null);
    setSendState("idle");
    try {
      const r = await api<{ reply: InboxComment; repliesLeft?: number | null }>("/api/inbox/reply", { method: "POST", json: { targetId: comment.targetId, commentId: comment.id, text: text.trim() } });
      onReplied(comment, { ...r.reply, targetId: comment.targetId, postId: comment.postId, platform: comment.platform, postTitle: comment.postTitle, postUrl: comment.postUrl });
      setText("");
      setIdeas(null);
      setLeft(typeof r.repliesLeft === "number" ? r.repliesLeft : null);
      setSendState("sent");
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "The reply didn't go through. Let's try again.");
      setSendState("failed");
      const wait = e2 instanceof ApiError && e2.status === 429 ? Number(e2.data?.retryAfter) || 60 : 0;
      if (wait) {
        setWaitUntil(Date.now() + wait * 1000);
        setNow(Date.now());
      }
    } finally {
      setBusy(false);
    }
  };

  const iconBtn = "grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
  const wideBtn = "lg:flex lg:h-11 lg:w-auto lg:items-center lg:gap-1.5 lg:rounded-xl lg:px-3.5 lg:text-[13px] lg:font-medium lg:hairline";
  const actBtn = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none [@media(hover:hover)]:hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:scale-[0.96]";

  return (
    <section aria-label={`Comment from ${comment.authorName}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-2 pb-2 pt-[max(8px,env(safe-area-inset-top))] lg:gap-3 lg:px-5 lg:py-3">
        <button type="button" onClick={onBack} aria-label="Back to comments" className={cn(iconBtn, "lg:hidden")}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-muted-foreground">
            Comment on {pname}
            {position ? ` · ${position}` : replied ? " · Replied" : ""}
          </p>
          <h2 className="truncate text-[15px] font-semibold" title={titleOf(comment)}>
            {titleOf(comment)}
          </h2>
        </div>
        {comment.postUrl && (
          <a href={comment.postUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open on ${pname}`} className={cn(iconBtn, wideBtn)}>
            <span className="hidden lg:inline">Open on {pname}</span>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 lg:px-6 lg:py-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
          <ReelCard comment={comment} onOpen={onPreview} />
          <div className="min-w-0 max-w-[640px] flex-1">
            <div className="flex gap-3">
              <PersonAvatar name={comment.authorName} platform={comment.platform} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px]">
                  <span className="font-semibold">{comment.authorName}</span>
                  <span className="ml-2 text-[12px] text-muted-foreground" suppressHydrationWarning>
                    {when(comment.createdAt)}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-base leading-relaxed">{comment.text}</p>
                <p className="mt-2 flex flex-wrap gap-1.5">
                  {comment.text.includes("?") && <Tag tone="question">Question</Tag>}
                  {comment.practice && <Tag>Practice</Tag>}
                  {replied && <Tag>Replied</Tag>}
                  {comment.archived && <Tag>Archived</Tag>}
                </p>
                <div role="group" aria-label="Comment actions" className="-ml-3 mt-2 flex flex-wrap items-center gap-1">
                  <button type="button" onClick={onToggleRead} className={actBtn}>
                    {unread ? <MailOpen className="h-4 w-4" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
                    {unread ? "Mark as read" : "Mark as unread"}
                  </button>
                  <button type="button" onClick={onToggleArchive} className={actBtn} title={comment.archived ? undefined : "Hides it in Outlly only. It stays on the platform."}>
                    {comment.archived ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
                    {comment.archived ? "Move to inbox" : "Archive"}
                  </button>
                  <button type="button" onClick={saveIdea} disabled={saved} aria-label={saved ? "Saved as an idea" : `Save ${comment.authorName}'s comment as a video idea`} className={cn(actBtn, "disabled:text-muted-foreground")}>
                    {saved ? <Check className="h-4 w-4" aria-hidden="true" /> : <Lightbulb className="h-4 w-4" aria-hidden="true" />}
                    {saved ? "Saved" : "Save as idea"}
                  </button>
                </div>
              </div>
            </div>
            {(comment.replies ?? []).length > 0 && (
              <ul aria-label="Replies" className="ml-[52px] mt-4 space-y-3 border-l-2 border-border pl-3.5">
                {comment.replies!.map((r) => {
                  const me = mine.has(norm(r.authorName));
                  return (
                    <li key={r.id} className="flex gap-2.5">
                      <PersonAvatar name={r.authorName} size={28} />
                      <div className="min-w-0">
                        <p className="text-[14px]">
                          <span className="font-semibold">{r.authorName}</span>
                          {me && <span className="ml-1.5 rounded-full bg-lime/25 px-1.5 py-px text-xs font-semibold text-lime-ink">You</span>}
                        </p>
                        <p className="whitespace-pre-wrap break-words text-[14px]">{r.text}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-border px-3 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 lg:pb-3.5 lg:pl-5 lg:pr-[76px]">
        {/* Same as the messages composer: it stays on screen, says who can answer, and sends nothing. */}
        {readOnly && (
          <p id={lockId} role="note" className="mb-2 rounded-2xl bg-secondary/60 p-3.5 text-sm">
            Editors can read comments. The workspace owner or a manager answers them.
          </p>
        )}
        {!comment.canReply && !readOnly && (
          <p role="note" className="mb-2 rounded-2xl bg-secondary/60 p-3.5 text-sm">
            {pname}&apos;s API doesn&apos;t let Outlly reply to comments. Open it on {pname} to answer.
          </p>
        )}
        {thinking && (
          <div className="mb-2.5" role="status" aria-label="Writing reply ideas">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-lime-ink">
              <Sparkles className="ai-orb-icon is-on h-3 w-3" aria-hidden="true" /> Writing reply ideas…
            </p>
            <ul className="flex gap-2" aria-hidden="true">
              {[34, 28, 30].map((w, i) => (
                <li key={i} className="ai-shimmer h-12 rounded-2xl" style={{ width: `${w}%`, ["--i" as string]: i }} />
              ))}
            </ul>
          </div>
        )}
        {ideas && !thinking && (
          <div className="reply-ideas mb-2.5" role="group" aria-label="Suggested replies. Tap one, then make it yours">
            <ul className="-mx-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
              {ideas.map((s, i) => (
                <li key={s.text} style={{ ["--i" as string]: i }} className="w-[80%] shrink-0 snap-start lg:w-auto lg:max-w-[340px] lg:shrink">
                  <button
                    type="button"
                    onClick={() => pick(s.text)}
                    aria-pressed={text === s.text}
                    className={cn(
                      "reply-idea h-full w-full rounded-2xl px-3 py-2 text-left text-[13px] leading-snug transition hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      text === s.text ? "bg-lime/15 text-foreground" : "bg-card text-foreground hover:bg-secondary",
                    )}
                  >
                    <span className="mb-0.5 block text-xs font-bold uppercase tracking-[0.1em] text-lime-ink">{s.label}</span>
                    {s.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(comment.canReply || readOnly) && (
        <form onSubmit={send} className="flex min-w-0 items-center gap-1.5 rounded-[18px] bg-card p-1.5 hairline focus-within:ring-2 focus-within:ring-foreground/25">
          <Button type="button" variant="ghost" size="icon" onClick={suggest} disabled={thinking || readOnly} aria-busy={thinking} aria-label={thinking ? "Writing reply ideas" : ideas ? "More reply ideas" : "Suggest replies"} title="Suggest replies" data-thinking={thinking ? "" : undefined} className="ai-orb shrink-0 rounded-[13px] disabled:opacity-100">
            <Sparkles className="ai-orb-icon h-4 w-4" aria-hidden="true" />
          </Button>
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            dir="auto"
            disabled={readOnly}
            placeholder={readOnly ? "Editors can't reply" : `Reply to ${first}…`}
            aria-label={`Reply to ${comment.authorName}`}
            aria-describedby={readOnly ? lockId : undefined}
            className="h-11 min-w-0 flex-1 bg-transparent px-1 text-[16px] text-foreground outline-none placeholder:text-muted-foreground lg:text-[15px]"
          />
          {/* shrink-0: the field takes the squeeze on a phone, the send button stays 44px (1044) */}
          <Button type="submit" variant="lime" size="icon" disabled={busy || readOnly || !text.trim()} aria-label="Send reply" className="shrink-0 rounded-[13px]">
            <Send className="h-4 w-4" aria-hidden="true" />
          </Button>
        </form>
        )}
        {busy && (
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            Sending to {pname}...
          </p>
        )}
        {!busy && sendState === "sent" && !err && (
          <p role="status" className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-lime-ink" aria-hidden="true" /> Sent. It is live on {pname}.
          </p>
        )}
        {err && (
          <div role="alert" className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-destructive">
            <p className="min-w-0 flex-1">
              {err}
              {waitLeft > 0 && <span className="tabular-nums"> ({waitLeft} s)</span>}
            </p>
            {sendState === "failed" && text.trim() && waitLeft === 0 && (
              <button type="button" onClick={() => void deliver()} className="inline-flex min-h-11 items-center rounded-full px-3 font-medium text-foreground underline [@media(hover:hover)]:hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                Try again
              </button>
            )}
          </div>
        )}
        {!err && left !== null && left <= 3 && (
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            {left === 0 ? "That was your last reply this week on your plan." : `${left} ${left === 1 ? "reply" : "replies"} left this week on your plan.`}
          </p>
        )}
        <p className="mt-2 hidden items-center gap-3.5 text-xs text-muted-foreground lg:flex">
          <span>
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> next / previous
          </span>
          <span>
            <Kbd>Enter</Kbd> send
          </span>
          {comment.media?.account && <span className="ml-auto truncate">Replying as {comment.media.account}</span>}
        </p>
      </div>
    </section>
  );
}

/** One banner per platform + reason, so ten posts behind one disconnected account read as one problem. */
function groupProblems(errors: InboxProblem[]) {
  const map = new Map<string, { platform: InboxProblem["platform"]; code: InboxProblem["code"]; items: InboxProblem[] }>();
  for (const e of errors) {
    const k = `${e.platform}:${e.code}`;
    const g = map.get(k) ?? { platform: e.platform, code: e.code, items: [] };
    g.items.push(e);
    map.set(k, g);
  }
  return Array.from(map.values());
}
