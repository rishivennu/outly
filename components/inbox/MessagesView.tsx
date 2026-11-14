"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, Clock, ExternalLink, Inbox as InboxIcon, Loader2, Paperclip, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { takeDeepLink } from "@/lib/client/deep-link";
import { PLATFORM_META } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { MessageView, ReplyBlock, ThreadView } from "@/lib/messages/service";
import { ago, ConnectionStrip, InboxRow, isTyping, isWide, joinNames, Kbd, PersonAvatar, ScopeBar, stripButton, Tag, useMobileLock, type PaneProps } from "./InboxList";

/** 1090: a reply the server has not confirmed yet. It is never drawn as sent until Meta accepted it. */
type Pending = { clientId: string; text: string; state: "sending" | "failed"; error?: string; at: string };
const newClientId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

type Problem = { platform: "instagram" | "facebook"; code: string; message: string; detail?: string };
/** dmsOff (1031f): platforms where the admin switched direct messages off, e.g. while Meta reviews the permission. */
export type DmData = { threads: ThreadView[]; accounts: number; problems?: Problem[]; readOnly?: boolean; dmsOff?: ("instagram" | "facebook")[] };
type Filter = "all" | "instagram" | "facebook";

const MAX = 1000;
const LIST_POLL_MS = 30_000;
const THREAD_POLL_MS = 15_000;

function hoursLeft(iso: string | null) {
  if (!iso) return 0;
  return Math.max(0, (new Date(iso).getTime() - Date.now()) / 3600_000);
}

/** 1093: waiting = they wrote last (or it is unread) and Meta still lets us answer here. */
export const threadNeedsReply = (t: Pick<ThreadView, "unread" | "snippet" | "canReply">) => t.unread > 0 || (t.canReply && !t.snippet.startsWith("You:"));
export const threadsWaiting = (threads: ThreadView[]) => threads.filter(threadNeedsReply).length;

function ThreadAvatar({ t, size = 40, badge = true }: { t: Pick<ThreadView, "participantAvatar" | "participantName" | "platform">; size?: number; badge?: boolean }) {
  const [broken, setBroken] = useState(false);
  return <PersonAvatar name={t.participantName} src={broken ? null : t.participantAvatar} platform={badge ? t.platform : undefined} size={size} onBroken={() => setBroken(true)} />;
}

/** Instagram and Facebook direct messages (1031). The list is our stored copy, fed by Meta's webhooks. */
export function MessagesView({ initial, tabs, query, refreshTick, refreshQuiet, onBusy, onWaiting }: { initial: DmData } & PaneProps) {
  const toast = useToast();
  const [data, setData] = useState<DmData>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [needsOnly, setNeedsOnly] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const synced = useRef(false);
  const rows = useRef(new Map<string, HTMLButtonElement>());

  const seq = useRef(0);
  // 1114: when the last load started and whether it is still out, so the freshness pass never repeats one.
  const lastLoad = useRef({ at: 0, out: false });
  // `background` (the poll) never cancels a load already on its way; it just steps aside for any newer one.
  const load = useCallback(async (f: Filter, sync = false, background = false) => {
    const mineSeq = background ? seq.current : ++seq.current;
    const mark: { at: number; out: boolean } | null = background ? null : (lastLoad.current = { at: Date.now(), out: true });
    if (sync) setSyncing(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (f !== "all") q.set("platform", f);
      if (sync) q.set("sync", "1");
      const next = await api<DmData>(`/api/messages${q.size ? `?${q}` : ""}`);
      if (mineSeq === seq.current) setData(next); // a slower, older answer never overwrites a newer one
    } catch (e) {
      if (mineSeq === seq.current) setError(e instanceof ApiError ? e.message : "We couldn't reach your messages just now.");
    } finally {
      if (sync) setSyncing(false);
      if (mark) mark.out = false;
    }
  }, []);

  // 1136: opened from a notification about one conversation (/inbox?tab=messages&thread=<id>). Read once,
  // then taken out of the address bar. The conversation may still be on its way: openId waits for it.
  useEffect(() => {
    const link = takeDeepLink(["thread"]);
    if (link) setOpenId(link.thread);
  }, []);

  // First visit with nothing stored yet: pull the recent conversations once.
  useEffect(() => {
    if (synced.current || initial.threads.length || !initial.accounts) return;
    synced.current = true;
    void load("all", true);
  }, [initial, load]);

  // New messages arrive by webhook; check our copy now and then while the tab is visible.
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === "visible" && void load(filter, false, true), LIST_POLL_MS);
    return () => clearInterval(id);
  }, [filter, load]);

  // The header's Refresh asks Meta for anything the webhooks missed.
  const firstTick = useRef(refreshTick);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  useEffect(() => {
    if (refreshTick === firstTick.current) return;
    // 1114: the page bringing itself up to date reads our copy (no Meta sync), and never right after a load.
    if (refreshQuiet) {
      const l = lastLoad.current;
      if (!l.out && Date.now() - l.at >= 5_000) void load(filterRef.current, false);
      return;
    }
    void load(filterRef.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick, load]);
  useEffect(() => onBusy(syncing), [syncing, onBusy]);

  const waiting = threadsWaiting(data.threads);
  useEffect(() => onWaiting(waiting), [waiting, onWaiting]);

  const pickFilter = (f: Filter) => {
    setFilter(f);
    setOpenId(null);
    void load(f);
  };

  const q = query.trim().toLowerCase();
  // An open conversation stays listed after you answer it, so it doesn't jump away mid-thought.
  const visible = data.threads.filter((t) => (!needsOnly || threadNeedsReply(t) || t.id === openId) && (!q || `${t.participantName} ${t.participantHandle ?? ""} ${t.snippet}`.toLowerCase().includes(q)));
  const open = data.threads.find((t) => t.id === openId) ?? null;
  const onRead = useCallback((id: string) => setData((d) => ({ ...d, threads: d.threads.map((t) => (t.id === id ? { ...t, unread: 0 } : t)) })), []);
  const onSent = (id: string, m: MessageView) =>
    setData((d) => {
      const t = d.threads.find((x) => x.id === id);
      if (!t) return d;
      const updated = { ...t, snippet: `You: ${m.text}`.slice(0, 140), lastMessageAt: m.sentAt, unread: 0 };
      return { ...d, threads: [updated, ...d.threads.filter((x) => x.id !== id)] };
    });
  const onClosed = (id: string, block: ReplyBlock) => setData((d) => ({ ...d, threads: d.threads.map((t) => (t.id === id ? { ...t, canReply: false, replyBlock: block } : t)) }));

  // J / K walk the conversations (opening one marks it read, as a click does); Escape closes it on a phone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && open && !isWide()) {
        // In the reply box, the first Escape only leaves the box; the draft stays.
        if (isTyping(e.target)) {
          (e.target as HTMLElement).blur();
          return;
        }
        setOpenId(null);
        return;
      }
      if (isTyping(e.target) || (e.key !== "j" && e.key !== "k") || !visible.length) return;
      const i = visible.findIndex((t) => t.id === openId);
      const next = visible[e.key === "j" ? Math.min(visible.length - 1, i + 1) : Math.max(0, i - 1)];
      e.preventDefault();
      setOpenId(next.id);
      requestAnimationFrame(() => rows.current.get(next.id)?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, openId, open]);

  useMobileLock(!!open);

  const off = data.dmsOff ?? [];
  const problems = data.problems ?? [];

  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {off.length > 0 && (
        <ConnectionStrip title={`${joinNames(off.map((p) => PLATFORM_META[p].name))} direct messages are switched off for now.`} body="Outlly will bring them in once Meta approves messaging. Comments, publishing and everything else work as usual." />
      )}
      {problems.length > 0 && <MessageProblems problems={problems} />}

      <div className="-mx-4 min-h-0 flex-1 sm:-mx-6 lg:mx-0 lg:grid lg:grid-cols-[minmax(320px,400px)_1fr] lg:overflow-hidden lg:rounded-[24px] lg:bg-card lg:hairline card-glass card-glass-desk">
        <section aria-label="Conversations" className="flex min-h-0 flex-col lg:border-r lg:border-border">
          <div className="px-4 pb-2 sm:px-6 lg:px-3 lg:pt-3">
            {tabs}
            <ScopeBar needsOnly={needsOnly} onNeedsOnly={setNeedsOnly} platforms={["instagram", "facebook"]} platform={filter} onPlatform={(p) => pickFilter(p as Filter)} />
          </div>
          <div role="tabpanel" id="inbox-panel-messages" aria-labelledby="inbox-tab-messages" aria-busy={syncing} className="min-h-0 flex-1 border-t border-border/70 lg:overflow-y-auto lg:overscroll-contain">
            {data.threads.length === 0 ? (
              <div className="p-10 text-center">
                <InboxIcon className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
                <p className="mt-3 font-medium">{data.accounts ? "No messages yet." : "Connect Instagram or a Facebook Page to see messages."}</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                  {data.accounts
                    ? "New direct messages show up here within seconds of arriving. Older ones come in when you press Refresh."
                    : "Go to Accounts and connect Instagram or Facebook. If you connected before messages were added, reconnect once so Outlly can ask for the messaging permission."}
                </p>
              </div>
            ) : visible.length === 0 ? (
              <div className="p-10 text-center">
                <Check className="mx-auto h-7 w-7 text-lime-ink" aria-hidden="true" />
                <p className="mt-3 font-medium">{q ? "Nothing matches that search." : "Nobody is waiting on you."}</p>
                {!q && needsOnly && (
                  <button type="button" onClick={() => setNeedsOnly(false)} className="mt-2 min-h-[44px] rounded-full px-4 text-sm font-medium underline hover:bg-secondary">
                    Show all conversations
                  </button>
                )}
              </div>
            ) : (
              <ul aria-label={needsOnly ? "Conversations waiting for you" : "All conversations"}>
                {visible.map((t) => {
                  const needs = threadNeedsReply(t);
                  const hrs = Math.floor(hoursLeft(t.windowEndsAt));
                  return (
                    <InboxRow
                      key={t.id}
                      id={`row-${t.id}`}
                      ref={(el) => {
                        if (el) rows.current.set(t.id, el);
                        else rows.current.delete(t.id);
                      }}
                      selected={t.id === openId}
                      needsReply={needs}
                      name={t.participantName}
                      avatar={<ThreadAvatar t={t} />}
                      tag={t.practice ? <Tag>Practice</Tag> : null}
                      time={ago(t.lastMessageAt)}
                      preview={t.snippet || "No text"}
                      context={
                        !t.canReply ? (
                          <span className="truncate">Reply window closed · answer in the app</span>
                        ) : needs ? (
                          <>
                            <Clock className="h-3.5 w-3.5 shrink-0 text-lime-ink" aria-hidden="true" />
                            <span className="truncate font-medium text-lime-ink">{hrs >= 1 ? `${hrs} h left to reply` : "Under an hour left to reply"}</span>
                          </>
                        ) : (
                          <>
                            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>Replied</span>
                          </>
                        )
                      }
                      label={`${t.participantName} on ${PLATFORM_META[t.platform].name}${t.unread ? `, ${t.unread} unread` : ""}${needs ? ", waiting for your reply" : ""}`}
                      onOpen={() => setOpenId(t.id)}
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
              {waiting} of {data.threads.length} need a reply
            </span>
          </footer>
        </section>

        <div data-inbox-detail={open ? "" : undefined} className={cn("min-h-0 min-w-0 flex-col", open ? "fixed inset-0 z-[60] flex bg-background lg:static lg:z-auto lg:bg-transparent" : "hidden lg:flex")}>
          {open ? (
            <ThreadPane
              key={open.id}
              thread={open}
              onBack={() => {
                const id = open.id;
                setOpenId(null);
                requestAnimationFrame(() => rows.current.get(id)?.focus());
              }}
              onRead={onRead}
              onSent={onSent}
              onClosed={onClosed}
              toast={toast}
              readOnly={!!initial.readOnly}
            />
          ) : (
            <div className="grid h-full place-items-center p-10 text-center text-sm text-muted-foreground">Pick a conversation to read it.</div>
          )}
        </div>
      </div>
    </>
  );
}

function MessageProblems({ problems }: { problems: Problem[] }) {
  const [more, setMore] = useState(false);
  return (
    <ConnectionStrip
      title={problems[0].message}
      body={problems.length > 1 ? `And ${problems.length - 1} more.` : undefined}
      actions={
        problems.some((p) => p.detail) || problems.length > 1 ? (
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} aria-controls="dm-problems" className={stripButton}>
            {more ? "Hide" : "Details"}
          </button>
        ) : undefined
      }
      details={
        more && (
          <ul id="dm-problems" className="mt-3 space-y-2 border-t border-warning/20 pt-3">
            {problems.map((p) => (
              <li key={`${p.platform}-${p.code}`}>
                <p className="font-medium">{p.message}</p>
                {p.detail && (
                  <details className="mt-1">
                    <summary className="cursor-pointer py-1 text-xs text-muted-foreground">What {PLATFORM_META[p.platform].name} said</summary>
                    <pre className="mt-1 whitespace-pre-wrap break-all text-xs text-muted-foreground">{p.detail}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

const dayOf = (iso: string) => new Date(iso).toDateString();
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function ThreadPane({
  thread,
  onBack,
  onRead,
  onSent,
  onClosed,
  toast,
  readOnly,
}: {
  thread: ThreadView;
  onBack: () => void;
  onRead: (id: string) => void;
  onSent: (id: string, m: MessageView) => void;
  onClosed: (id: string, block: ReplyBlock) => void;
  toast: ReturnType<typeof useToast>;
  readOnly: boolean;
}) {
  const [messages, setMessages] = useState<MessageView[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [ideas, setIdeas] = useState<{ label: string; text: string }[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [block, setBlock] = useState<ReplyBlock | null>(thread.replyBlock ?? (thread.canReply ? null : { code: "WINDOW_CLOSED", message: "" }));
  const [pending, setPending] = useState<Pending[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const name = PLATFORM_META[thread.platform].name;

  const fetchThread = useCallback(async () => {
    try {
      const r = await api<{ thread: ThreadView; messages: MessageView[] }>(`/api/messages/${thread.id}`);
      setMessages(r.messages);
      setBlock(r.thread.replyBlock ?? null);
      setLoadErr(null);
      onRead(thread.id);
    } catch (e) {
      setLoadErr(e instanceof ApiError ? e.message : "We couldn't open this conversation just now.");
    }
  }, [thread.id, onRead]);

  useEffect(() => {
    void fetchThread();
    const id = setInterval(() => document.visibilityState === "visible" && void fetchThread(), THREAD_POLL_MS);
    return () => clearInterval(id);
  }, [fetchThread]);

  // Braces matter: newer Chromium returns a Promise from scrollIntoView, and React would call it as a cleanup (crash).
  // 1090: scroll the message list itself, not the page; scrolling the page parked the composer below the fold.
  useEffect(() => {
    const el = bottom.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length, pending.length]);

  const lastIn = [...(messages ?? [])].reverse().find((m) => m.direction === "in");

  const suggest = async () => {
    if (!lastIn?.text) return;
    setThinking(true);
    setErr(null);
    try {
      const r = await api<{ suggestions: { label: string; text: string }[] }>("/api/ai/replies", {
        method: "POST",
        json: { comment: lastIn.text.slice(0, 2000), author: thread.participantName.slice(0, 120), platform: thread.platform, postTitle: "A private direct message" },
      });
      setIdeas(r.suggestions);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't think of replies just now. Try again in a moment.");
    } finally {
      setThinking(false);
    }
  };

  /** Deliver one pending reply. The bubble only turns into a sent message when the server says Meta took it. */
  const deliver = async (p: Pending) => {
    setPending((list) => list.map((x) => (x.clientId === p.clientId ? { ...x, state: "sending", error: undefined } : x)));
    try {
      const r = await api<{ message: MessageView; repliesLeft: number | null; practice: boolean }>(`/api/messages/${thread.id}`, { method: "POST", json: { text: p.text, clientId: p.clientId } });
      setPending((list) => list.filter((x) => x.clientId !== p.clientId));
      setMessages((m) => (m?.some((x) => x.id === r.message.id) ? m : [...(m ?? []), r.message]));
      onSent(thread.id, r.message);
      setLeft(typeof r.repliesLeft === "number" ? r.repliesLeft : null);
      if (r.practice) toast("Sent on the practice account. Nothing left Outlly.");
      void fetchThread(); // pick up the stored copy (and anything that arrived meanwhile)
    } catch (e2) {
      const code = e2 instanceof ApiError ? e2.code : undefined;
      const msg = e2 instanceof ApiError ? e2.message : "The message didn't go through. Check your connection and try again.";
      if (code === "WINDOW_CLOSED" || code === "NOT_CONNECTED" || code === "DMS_OFF") {
        const b: ReplyBlock = { code, message: msg };
        setBlock(b);
        onClosed(thread.id, b);
      }
      setPending((list) => list.map((x) => (x.clientId === p.clientId ? { ...x, state: "failed", error: msg } : x)));
    }
  };

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || block || readOnly || pending.some((x) => x.state === "sending")) return;
    setErr(null);
    const p: Pending = { clientId: newClientId(), text: body, state: "sending", at: new Date().toISOString() };
    setPending((list) => [...list, p]);
    setText("");
    setIdeas(null);
    void deliver(p);
  };
  const busy = pending.some((x) => x.state === "sending");

  const hrs = hoursLeft(thread.windowEndsAt);
  const locked = readOnly || !!block;
  const appLink = thread.platform === "instagram" ? "https://www.instagram.com/direct/inbox/" : "https://business.facebook.com/latest/inbox";

  return (
    <section aria-label={`Conversation with ${thread.participantName}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2.5 border-b border-border px-2 pb-2 pt-[max(8px,env(safe-area-inset-top))] lg:gap-3 lg:px-5 lg:py-3">
        <button type="button" onClick={onBack} aria-label="Back to conversations" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring lg:hidden">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <ThreadAvatar t={thread} size={38} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">{thread.participantName}</h2>
          <p className="truncate text-[12px] text-muted-foreground">
            {thread.participantHandle ? `${thread.participantHandle} · ` : ""}
            {name} · to {thread.accountName}
          </p>
        </div>
        {!locked ? (
          <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-lime/20 px-3 text-[13px] font-semibold text-lime-ink" title="Meta lets you reply here for 24 hours after their last message">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <span suppressHydrationWarning>{hrs >= 1 ? `${Math.floor(hrs)} h left` : "Under 1 h left"}</span>
          </span>
        ) : block?.code === "WINDOW_CLOSED" ? (
          <span className="inline-flex h-8 shrink-0 items-center rounded-full bg-secondary px-3 text-[13px] font-medium text-muted-foreground">Window closed</span>
        ) : null}
        <a href={appLink} target="_blank" rel="noopener noreferrer" aria-label={`Open in ${name}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring lg:flex lg:h-10 lg:w-auto lg:items-center lg:gap-1.5 lg:rounded-xl lg:px-3.5 lg:text-[13px] lg:font-medium lg:hairline">
          <span className="hidden lg:inline">Open in {name}</span> <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 lg:px-6" aria-live="polite">
        {loadErr && (
          <p role="alert" className="text-sm text-destructive">
            {loadErr}
          </p>
        )}
        {!messages && !loadErr && <p className="text-sm text-muted-foreground">Opening…</p>}
        {messages && messages.length === 0 && <p className="text-sm text-muted-foreground">No messages stored for this conversation yet.</p>}
        <ol className="space-y-2">
          {(messages ?? []).map((m, i, all) => (
            <li key={m.id} className={cn("flex flex-wrap", m.direction === "out" ? "justify-end" : "justify-start")}>
              {(i === 0 || dayOf(all[i - 1].sentAt) !== dayOf(m.sentAt)) && (
                <p className="mb-1 mt-2 w-full text-center text-xs font-medium text-muted-foreground first:mt-0" suppressHydrationWarning>
                  {dayLabel(m.sentAt)}
                </p>
              )}
              <div className={cn("max-w-[80%] rounded-[20px] px-3.5 py-2 text-[15px] lg:max-w-[70%]", m.direction === "out" ? "bg-lime/25 text-foreground dark:bg-lime/20" : "bg-secondary text-foreground")}>
                {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                {m.attachments.map((a, i) =>
                  a.url && /^https:\/\//i.test(a.url) ? (
                    <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-[32px] items-center gap-1 text-xs underline">
                      <Paperclip className="h-3 w-3" aria-hidden="true" /> {a.type === "image" ? "Photo" : a.type === "video" ? "Video" : "Attachment"}
                    </a>
                  ) : (
                    <p key={i} className="mt-1 text-xs text-muted-foreground">
                      {a.type === "image" ? "Photo" : a.type === "video" ? "Video" : "Attachment"} (open it in {name})
                    </p>
                  ),
                )}
                <p className="mt-0.5 text-right text-xs text-muted-foreground">
                  <span className="sr-only">{m.direction === "out" ? "You, " : `${thread.participantName}, `}</span>
                  {new Date(m.sentAt).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" })}
                </p>
              </div>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.clientId} className="flex flex-col items-end">
              <div className={cn("max-w-[80%] rounded-[20px] px-3.5 py-2 text-[15px]", p.state === "failed" ? "bg-destructive/10 text-foreground ring-1 ring-destructive/40" : "bg-lime/10 text-foreground opacity-80")}>
                <p className="whitespace-pre-wrap break-words">{p.text}</p>
                <p className="mt-0.5 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                  {p.state === "sending" ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Sending…
                    </>
                  ) : (
                    <span className="flex items-center gap-1 font-medium text-destructive">
                      <AlertCircle className="h-3 w-3" aria-hidden="true" /> Not sent
                    </span>
                  )}
                </p>
              </div>
              {p.state === "failed" && (
                <div className="mt-1 flex max-w-[80%] flex-wrap items-center justify-end gap-2 text-xs">
                  {p.error && <span className="text-destructive">{p.error}</span>}
                  {!block && (
                    <button type="button" onClick={() => void deliver(p)} className="min-h-[32px] rounded-full px-2.5 font-medium underline hover:bg-secondary">
                      Retry
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setPending((list) => list.filter((x) => x.clientId !== p.clientId));
                      if (!text.trim()) setText(p.text);
                    }}
                    className="min-h-[32px] rounded-full px-2.5 font-medium text-muted-foreground underline hover:bg-secondary"
                  >
                    Edit
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
        <div ref={bottom} />
      </div>

      <div className="border-t border-border px-3 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 lg:pb-3.5 lg:pl-5 lg:pr-[76px]">
        {/* 1090: the composer is always there. When it can't send, it says why and where to answer instead. */}
        {readOnly ? (
          <p id={`dm-lock-${thread.id}`} role="note" className="mb-2 rounded-2xl bg-secondary/60 p-3.5 text-sm">
            Editors can read messages. The workspace owner or a manager answers them.
          </p>
        ) : block?.code === "WINDOW_CLOSED" ? (
          <div id={`dm-lock-${thread.id}`} role="note" className="mb-2 rounded-2xl bg-secondary/60 p-3.5 text-sm">
            <p className="font-medium">The 24-hour reply window has closed.</p>
            <p className="mt-1 text-muted-foreground">
              Meta only lets apps answer within 24 hours of {thread.participantName}&apos;s last message. You can still reply in{" "}
              <a href={appLink} target="_blank" rel="noopener noreferrer" className="underline">
                {thread.platform === "instagram" ? "the Instagram app" : "Meta Business Suite"}
              </a>
              . When they write again, you can answer here.
            </p>
          </div>
        ) : block ? (
          <div id={`dm-lock-${thread.id}`} role="note" className="mb-2 rounded-2xl bg-secondary/60 p-3.5 text-sm">
            <p className="font-medium">{block.message}</p>
            {block.code === "NOT_CONNECTED" ? (
              <a href="/accounts" className="mt-1 inline-flex min-h-[32px] items-center text-sm underline">
                Go to Accounts
              </a>
            ) : (
              <a href={appLink} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-[32px] items-center gap-1 text-sm underline">
                Open {name} <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
          </div>
        ) : null}
        {ideas && (
          <div className="mb-2" role="group" aria-label="Suggested replies">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <Sparkles className="h-3 w-3" aria-hidden="true" /> Tap one, then make it yours
            </p>
            <ul className="flex flex-col gap-1.5">
              {ideas.map((s) => (
                <li key={s.text}>
                  <button
                    type="button"
                    onClick={() => {
                      setText(s.text.slice(0, MAX));
                      requestAnimationFrame(() => box.current?.focus());
                    }}
                    aria-pressed={text === s.text}
                    className="w-full rounded-2xl bg-card px-3.5 py-2.5 text-left text-sm transition hairline hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="mr-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-ink dark:text-lime">{s.label}</span>
                    {s.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <form onSubmit={send} className={cn("flex items-end gap-1.5 rounded-[18px] bg-card p-1.5 hairline focus-within:ring-2 focus-within:ring-foreground/25", locked && "opacity-70")}>
          <Button type="button" variant="ghost" size="icon" onClick={suggest} disabled={locked || thinking || !lastIn?.text} aria-label={ideas ? "More reply ideas" : "Suggest replies"} title="Suggest replies" className="h-11 w-11 shrink-0 rounded-[13px]">
            <Sparkles className={cn("h-4 w-4", thinking && "animate-pulse")} aria-hidden="true" />
          </Button>
          <Textarea
            ref={box}
            rows={1}
            value={text}
            maxLength={MAX}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={locked}
            aria-disabled={locked}
            aria-describedby={locked ? `dm-lock-${thread.id}` : undefined}
            placeholder={locked ? (readOnly ? "Editors can't reply" : block?.code === "WINDOW_CLOSED" ? "Reply window closed" : "Replies unavailable here") : `Message ${thread.participantName}…`}
            aria-label={`Message ${thread.participantName}`}
            className="max-h-40 min-h-[44px] rounded-none border-0 bg-transparent px-1 py-2.5 text-[16px] shadow-none outline-none ring-0 [box-shadow:none] focus:bg-transparent lg:text-[15px]"
          />
          <Button type="submit" variant="lime" size="icon" disabled={locked || busy || !text.trim()} aria-label={busy ? "Sending" : "Send message"} className="h-11 w-11 shrink-0 rounded-[13px]">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </form>
        {!locked && (
          <p className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
            <span className="hidden lg:inline">
              <Kbd>Enter</Kbd> send
            </span>
            <span className="hidden lg:inline">
              <Kbd>Shift</Kbd>
              <Kbd>Enter</Kbd> new line
            </span>
            <span className="lg:ml-auto" suppressHydrationWarning>
              {hrs >= 1 ? `You can reply for about ${Math.floor(hrs)} more ${Math.floor(hrs) === 1 ? "hour" : "hours"}.` : "Less than an hour left to reply."} {text.length > MAX - 100 && `${MAX - text.length} characters left.`}
            </span>
          </p>
        )}
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
      </div>
    </section>
  );
}
