"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, ExternalLink, Image as ImageIcon, Lightbulb, Link2, MessagesSquare, Play, RefreshCw, Search, Send, Sparkles, X } from "lucide-react";
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
import { ago, ConnectionStrip, InboxRow, InboxTabs, isTyping, isWide, joinNames, Kbd, PersonAvatar, ScopeBar, stripButton, Tag, useMobileLock, type InboxTab, type PaneProps } from "./InboxList";

type Data = { comments: InboxComment[]; errors: InboxProblem[]; targets: number };

/**
 * 1093: the inbox as a mail client. One compact header, one connection strip, a dense list on the left and the open
 * comment or conversation on the right (full screen on a phone). Messages (1031) are the second tab.
 */
export function InboxView({ initial, dms, initialTab = "comments", renderedAt, readOnly = false }: { initial: Data; dms?: DmData; initialTab?: InboxTab; renderedAt?: number; readOnly?: boolean }) {
  // 1114: with no ?tab= in the link (the tab bar's), Comments or Messages as you left them.
  const params = useSearchParams();
  const keptTab = useTabMemory<InboxTab>("inbox:tab", (v) => (v === "messages" || v === "comments" ? v : null));
  const restoredTab = dms && !params?.get("tab") && keptTab.saved === "messages" ? "messages" : null;
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
        <Button variant="outline" onClick={() => setRefreshTick((n) => n + 1)} disabled={busy} aria-label={busy ? "Checking for new comments and messages" : "Refresh"} className="h-11 w-11 px-0 lg:h-10 lg:w-auto lg:rounded-xl lg:px-4">
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
  return comments.filter((c) => !hasOwnReply(c, mine) && !isOwn(c, mine)).length;
}
const keyOf = (c: Pick<InboxComment, "targetId" | "id">) => `${c.targetId}-${c.id}`;
const titleOf = (c: InboxComment) => c.postTitle ?? "a post";

function CommentsPane({ initial, hasTabs, readOnly, tabs, query, refreshTick, refreshQuiet, onBusy, onWaiting }: PaneProps & { initial: Data; hasTabs: boolean; readOnly: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<Data>(initial);
  // 1114: the platform and "needs a reply" filters as you left them (kept per account, for half an hour).
  const kept = useTabMemory<{ platform: Platform | "all"; needsOnly: boolean }>("inbox:comments", (v) => {
    const o = v as { platform?: unknown; needsOnly?: unknown } | null;
    return o && typeof o === "object" && (o.platform === "all" || (typeof o.platform === "string" && o.platform in PLATFORM_META)) && typeof o.needsOnly === "boolean" ? (o as { platform: Platform | "all"; needsOnly: boolean }) : null;
  });
  const [platform, setPlatform] = useState<Platform | "all">(kept.saved?.platform ?? "all");
  const live = useLivePlatforms();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsOnly, setNeedsOnly] = useState(kept.saved?.needsOnly ?? true);
  // 1114: a newer server render (a profile switch, a refresh) replaces the list, unless a platform filter loaded its own.
  const [given, setGiven] = useState(initial);
  if (initial !== given) {
    setGiven(initial);
    if (platform === "all") setData(initial);
  }
  const { save: saveFilters } = kept;
  useEffect(() => saveFilters({ platform, needsOnly }), [platform, needsOnly, saveFilters]);
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
  }, []);
  // Answered from here this visit, even when the platform's copy of the reply hasn't come back yet.
  const [answered, setAnswered] = useState<Set<string>>(() => new Set());
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const preview = usePreview();

  const mine = useMemo(() => ownNames(data.comments), [data.comments]);
  const replied = useCallback((c: InboxComment) => answered.has(keyOf(c)) || hasOwnReply(c, mine) || isOwn(c, mine), [answered, mine]);
  const waitingList = data.comments.filter((c) => !replied(c));
  useEffect(() => onWaiting(waitingList.length), [waitingList.length, onWaiting]);
  useEffect(() => onBusy(loading), [loading, onBusy]);

  const q = query.trim().toLowerCase();
  // The open comment stays in the list after it is answered, so the reply you just sent doesn't vanish under you.
  const visible = data.comments.filter((c) => (!needsOnly || !replied(c) || keyOf(c) === openKey) && (!q || `${c.authorName} ${c.text} ${c.postTitle ?? ""}`.toLowerCase().includes(q)));
  const open = data.comments.find((c) => keyOf(c) === openKey) ?? null;

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
    if (kept.saved && kept.saved.platform !== "all") void loadRef.current(kept.saved.platform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Side by side, the right side is never blank: open the first comment. On a phone the list comes first.
  const firstKey = visible[0] ? keyOf(visible[0]) : null;
  useEffect(() => {
    if (deep.current && (open ? keyOf(open) === deep.current.key : Date.now() - deep.current.at < 8_000)) {
      if (open) deep.current = null; // the asked-for comment arrived
      return;
    }
    if (!open && firstKey && isWide()) setOpenKey(firstKey);
  }, [open, firstKey]);

  const go = useCallback((k: string) => {
    setOpenKey(k);
    requestAnimationFrame(() => rows.current.get(k)?.focus());
  }, []);

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
      go(keyOf(visible[next]));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, openKey, open, go, preview.open]);

  useMobileLock(!!open);

  const onReplied = (c: InboxComment, reply: InboxComment) => {
    setData((d) => ({ ...d, comments: d.comments.map((x) => (keyOf(x) === keyOf(c) ? { ...x, replies: [...(x.replies ?? []), reply] } : x)) }));
    setAnswered((s) => new Set(s).add(keyOf(c)));
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
            <ScopeBar needsOnly={needsOnly} onNeedsOnly={setNeedsOnly} platforms={live} platform={platform} onPlatform={(p) => void load(p)} />
          </div>
          <div role={hasTabs ? "tabpanel" : undefined} id="inbox-panel-comments" aria-labelledby={hasTabs ? "inbox-tab-comments" : undefined} aria-busy={loading} className="min-h-0 flex-1 border-t border-border/70 lg:overflow-y-auto lg:overscroll-contain">
            {data.comments.length === 0 ? (
              <div className="p-10 text-center">
                <MessagesSquare className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
                <p className="mt-3 font-medium">{data.targets === 0 ? "No comments to show yet." : "No comments yet."}</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">{data.targets === 0 ? "Connect an account on the Accounts page and comments on your recent posts land here." : "We checked your recent posts on every connected account. Give it time."}</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="p-10 text-center">
                <Check className="mx-auto h-7 w-7 text-lime-ink" aria-hidden="true" />
                <p className="mt-3 font-medium">{q ? "Nothing matches that search." : "You've answered everyone."}</p>
                {!q && needsOnly && (
                  <button type="button" onClick={() => setNeedsOnly(false)} className="mt-2 min-h-[44px] rounded-full px-4 text-sm font-medium underline hover:bg-secondary">
                    Show all comments
                  </button>
                )}
              </div>
            ) : (
              <ul aria-label={needsOnly ? "Comments that need a reply" : "All comments"}>
                {visible.map((c) => {
                  const k = keyOf(c);
                  const done = replied(c);
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
                      name={c.authorName}
                      avatar={<PersonAvatar name={c.authorName} platform={c.platform} />}
                      tag={c.practice ? <Tag>Practice</Tag> : c.text.includes("?") ? <Tag tone="question">Question</Tag> : null}
                      time={ago(c.createdAt)}
                      preview={c.text}
                      context={
                        done ? (
                          <>
                            <Check className="h-3.5 w-3.5 shrink-0 text-lime-ink" aria-hidden="true" />
                            <span className="shrink-0 font-medium text-lime-ink">{isOwn(c, mine) ? "Your comment" : "Replied"}</span>
                            <span className="truncate">· on {titleOf(c)}</span>
                          </>
                        ) : (
                          <span className="truncate">on {titleOf(c)}</span>
                        )
                      }
                      label={`${c.authorName} on ${PLATFORM_META[c.platform].name}, ${done ? "replied" : "needs a reply"}: ${c.text.slice(0, 90)}`}
                      onOpen={() => setOpenKey(k)}
                    />
                  );
                })}
              </ul>
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
            <span className="ml-auto">
              {waitingList.length} of {data.comments.length} need a reply
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
  onBack,
  onReplied,
  onPreview,
}: {
  comment: InboxComment;
  replied: boolean;
  mine: Set<string>;
  readOnly: boolean;
  position: string | null;
  onBack: () => void;
  onReplied: (c: InboxComment, reply: InboxComment) => void;
  onPreview: (from: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || !text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ reply: InboxComment; repliesLeft?: number | null }>("/api/inbox/reply", { method: "POST", json: { targetId: comment.targetId, commentId: comment.id, text: text.trim() } });
      onReplied(comment, { ...r.reply, targetId: comment.targetId, postId: comment.postId, platform: comment.platform, postTitle: comment.postTitle, postUrl: comment.postUrl });
      setText("");
      setIdeas(null);
      setLeft(typeof r.repliesLeft === "number" ? r.repliesLeft : null);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "The reply didn't go through. Let's try again.");
    } finally {
      setBusy(false);
    }
  };

  const iconBtn = "grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
  const wideBtn = "lg:flex lg:h-10 lg:w-auto lg:items-center lg:gap-1.5 lg:rounded-xl lg:px-3.5 lg:text-[13px] lg:font-medium lg:hairline";

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
        <button type="button" onClick={saveIdea} disabled={saved} aria-label={saved ? "Saved as an idea" : `Save ${comment.authorName}'s comment as a video idea`} className={cn(iconBtn, wideBtn, "disabled:text-muted-foreground")}>
          {saved ? <Check className="h-4 w-4" aria-hidden="true" /> : <Lightbulb className="h-4 w-4" aria-hidden="true" />}
          <span className="hidden lg:inline">{saved ? "Saved" : "Save as idea"}</span>
        </button>
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
                </p>
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
        {err && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {err}
          </p>
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
