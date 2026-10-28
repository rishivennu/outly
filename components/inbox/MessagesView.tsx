"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Clock, ExternalLink, Inbox as InboxIcon, Paperclip, RefreshCw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORM_META } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { MessageView, ThreadView } from "@/lib/messages/service";

type Problem = { platform: "instagram" | "facebook"; code: string; message: string; detail?: string };
/** dmsOff (1031f): platforms where the admin switched direct messages off, e.g. while Meta reviews the permission. */
export type DmData = { threads: ThreadView[]; accounts: number; problems?: Problem[]; readOnly?: boolean; dmsOff?: ("instagram" | "facebook")[] };
type Filter = "all" | "instagram" | "facebook";

const MAX = 1000;
const LIST_POLL_MS = 30_000;
const THREAD_POLL_MS = 15_000;

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function hoursLeft(iso: string | null) {
  if (!iso) return 0;
  return Math.max(0, (new Date(iso).getTime() - Date.now()) / 3600_000);
}

function Avatar({ t, size = 40 }: { t: Pick<ThreadView, "participantAvatar" | "participantName" | "platform">; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (t.participantAvatar && !broken)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={t.participantAvatar} alt="" width={size} height={size} onError={() => setBroken(true)} referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full bg-secondary text-[13px] font-semibold text-foreground" style={{ width: size, height: size }}>
      {(t.participantName.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** Instagram and Facebook direct messages (1031). The list is our stored copy, fed by Meta's webhooks. */
export function MessagesView({ initial }: { initial: DmData }) {
  const toast = useToast();
  const [data, setData] = useState<DmData>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const synced = useRef(false);

  const load = useCallback(async (f: Filter, sync = false) => {
    if (sync) setSyncing(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (f !== "all") q.set("platform", f);
      if (sync) q.set("sync", "1");
      const next = await api<DmData>(`/api/messages${q.size ? `?${q}` : ""}`);
      setData(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "We couldn't reach your messages just now.");
    } finally {
      if (sync) setSyncing(false);
    }
  }, []);

  // First visit with nothing stored yet: pull the recent conversations once.
  useEffect(() => {
    if (synced.current || initial.threads.length || !initial.accounts) return;
    synced.current = true;
    void load("all", true);
  }, [initial, load]);

  // New messages arrive by webhook; check our copy now and then while the tab is visible.
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === "visible" && void load(filter), LIST_POLL_MS);
    return () => clearInterval(id);
  }, [filter, load]);

  const pickFilter = (f: Filter) => {
    setFilter(f);
    setOpenId(null);
    void load(f);
  };

  const open = data.threads.find((t) => t.id === openId) ?? null;
  const onRead = (id: string) => setData((d) => ({ ...d, threads: d.threads.map((t) => (t.id === id ? { ...t, unread: 0 } : t)) }));
  const onSent = (id: string, m: MessageView) =>
    setData((d) => {
      const t = d.threads.find((x) => x.id === id);
      if (!t) return d;
      const updated = { ...t, snippet: `You: ${m.text}`.slice(0, 140), lastMessageAt: m.sentAt, unread: 0 };
      return { ...d, threads: [updated, ...d.threads.filter((x) => x.id !== id)] };
    });
  const onClosed = (id: string) => setData((d) => ({ ...d, threads: d.threads.map((t) => (t.id === id ? { ...t, canReply: false } : t)) }));

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "instagram", "facebook"] as const).map((f) => (
          <button
            key={f}
            onClick={() => pickFilter(f)}
            aria-pressed={filter === f}
            className={cn("h-10 rounded-full px-4 text-[13px] font-medium transition hairline", filter === f ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60")}
          >
            {f === "all" ? "Everything" : PLATFORM_META[f].name}
          </button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => load(filter, true)} disabled={syncing} className="ml-auto">
          <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} aria-hidden="true" /> {syncing ? "Checking…" : "Refresh"}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {!!data.dmsOff?.length && (
        <div role="status" className="mt-4 rounded-2xl bg-secondary/60 p-4 text-sm hairline">
          <p className="font-medium text-foreground">
            {data.dmsOff.length === 2 ? "Instagram and Facebook" : PLATFORM_META[data.dmsOff[0]].name} direct messages are switched off for now.
          </p>
          <p className="mt-1 text-muted-foreground">
            Outlly will bring them in once Meta approves messaging. Comments, publishing and everything else work as usual.
          </p>
        </div>
      )}
      {(data.problems ?? []).map((p) => (
        <div key={`${p.platform}-${p.code}`} role="status" className="mt-4 rounded-2xl bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">{p.message}</p>
          {p.detail && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">What {PLATFORM_META[p.platform].name} said</summary>
              <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-muted-foreground">{p.detail}</pre>
            </details>
          )}
        </div>
      ))}

      {data.threads.length === 0 ? (
        <div className="mt-8 rounded-[28px] bg-secondary/40 p-10 text-center hairline">
          <InboxIcon className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
          <p className="mt-3 font-medium">{data.accounts ? "No messages yet." : "Connect Instagram or a Facebook Page to see messages."}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {data.accounts
              ? "New direct messages show up here within seconds of arriving. Older ones come in when you press Refresh."
              : "Go to Accounts and connect Instagram or Facebook. If you connected before messages were added, reconnect once so Outlly can ask for the messaging permission."}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid min-h-[60dvh] gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <ul aria-label="Conversations" className={cn("space-y-1.5", open && "hidden lg:block")}>
            {data.threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(t.id)}
                  aria-current={t.id === openId ? "true" : undefined}
                  aria-label={`${t.participantName} on ${PLATFORM_META[t.platform].name}${t.unread ? `, ${t.unread} unread` : ""}`}
                  className={cn(
                    "flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    t.id === openId ? "bg-secondary" : "bg-secondary/40 hover:bg-secondary/70",
                  )}
                >
                  <span className="relative">
                    <Avatar t={t} />
                    <PlatformOrb platform={t.platform} size={18} ring className="absolute -bottom-1 -right-1" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn("truncate text-sm", t.unread ? "font-semibold" : "font-medium")}>{t.participantName}</span>
                      {t.practice && <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">Practice</span>}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{ago(t.lastMessageAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className={cn("truncate text-[13px]", t.unread ? "text-foreground" : "text-muted-foreground")}>{t.snippet || "No text"}</span>
                      {t.unread > 0 && <span aria-hidden="true" className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-lime" />}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className={cn(!open && "hidden lg:block")}>
            {open ? (
              <ThreadPane key={open.id} thread={open} onBack={() => setOpenId(null)} onRead={onRead} onSent={onSent} onClosed={onClosed} toast={toast} readOnly={!!initial.readOnly} />
            ) : (
              <div className="grid h-full place-items-center rounded-[28px] bg-secondary/30 p-10 text-center text-sm text-muted-foreground hairline">Pick a conversation to read it.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
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
  onClosed: (id: string) => void;
  toast: ReturnType<typeof useToast>;
  readOnly: boolean;
}) {
  const [messages, setMessages] = useState<MessageView[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [ideas, setIdeas] = useState<{ label: string; text: string }[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [canReply, setCanReply] = useState(thread.canReply);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const name = PLATFORM_META[thread.platform].name;

  const fetchThread = useCallback(async () => {
    try {
      const r = await api<{ thread: ThreadView; messages: MessageView[] }>(`/api/messages/${thread.id}`);
      setMessages(r.messages);
      setCanReply(r.thread.canReply);
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

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [messages?.length]);

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

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ message: MessageView; repliesLeft: number | null; practice: boolean }>(`/api/messages/${thread.id}`, { method: "POST", json: { text: body } });
      setMessages((m) => [...(m ?? []), r.message]);
      onSent(thread.id, r.message);
      setText("");
      setIdeas(null);
      setLeft(typeof r.repliesLeft === "number" ? r.repliesLeft : null);
      if (r.practice) toast("Sent on the practice account. Nothing left Outlly.");
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === "WINDOW_CLOSED") {
        setCanReply(false);
        onClosed(thread.id);
      }
      setErr(e2 instanceof ApiError ? e2.message : "The message didn't go through. Let's try again.");
    } finally {
      setBusy(false);
    }
  };

  const hrs = hoursLeft(thread.windowEndsAt);
  const appLink = thread.platform === "instagram" ? "https://www.instagram.com/direct/inbox/" : "https://business.facebook.com/latest/inbox";

  return (
    <section aria-label={`Conversation with ${thread.participantName}`} className="flex h-full min-h-[60dvh] flex-col rounded-[28px] bg-secondary/30 hairline">
      <header className="flex items-center gap-3 border-b border-foreground/10 px-3 py-3 sm:px-4">
        <button type="button" onClick={onBack} aria-label="Back to conversations" className="grid h-11 w-11 place-items-center rounded-full hover:bg-secondary lg:hidden">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <Avatar t={thread} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{thread.participantName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {thread.participantHandle ? `${thread.participantHandle} · ` : ""}
            {name} · to {thread.accountName}
          </p>
        </div>
        <a href={appLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-secondary">
          Open in {name} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-4" aria-live="polite">
        {loadErr && (
          <p role="alert" className="text-sm text-destructive">
            {loadErr}
          </p>
        )}
        {!messages && !loadErr && <p className="text-sm text-muted-foreground">Opening…</p>}
        {messages && messages.length === 0 && <p className="text-sm text-muted-foreground">No messages stored for this conversation yet.</p>}
        <ol className="space-y-2">
          {(messages ?? []).map((m) => (
            <li key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[80%] rounded-[20px] px-3.5 py-2 text-[14.5px]", m.direction === "out" ? "bg-lime/20 text-foreground" : "bg-card text-foreground hairline")}>
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
                <p className="mt-0.5 text-right text-[10.5px] text-muted-foreground">
                  <span className="sr-only">{m.direction === "out" ? "You, " : `${thread.participantName}, `}</span>
                  {new Date(m.sentAt).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" })}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div ref={bottom} />
      </div>

      <div className="border-t border-foreground/10 px-3 py-3 sm:px-4">
        {readOnly ? (
          <p role="note" className="rounded-2xl bg-secondary/60 p-3.5 text-sm">
            Editors can read messages. The workspace owner or a manager answers them.
          </p>
        ) : canReply ? (
          <>
            {ideas && (
              <div className="mb-2" role="group" aria-label="Suggested replies">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
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
                        <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-lime-ink dark:text-lime">{s.label}</span>
                        {s.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <form onSubmit={send} className="flex items-end gap-2">
              <Button type="button" variant="ghost" size="icon" onClick={suggest} disabled={thinking || !lastIn?.text} aria-label={ideas ? "More reply ideas" : "Suggest replies"} title="Suggest replies" className="h-11 w-11 shrink-0">
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
                placeholder={`Message ${thread.participantName}…`}
                aria-label={`Message ${thread.participantName}`}
                className="max-h-40 min-h-[44px] py-2.5 text-sm"
              />
              <Button type="submit" variant="lime" size="icon" disabled={busy || !text.trim()} aria-label="Send message" className="h-11 w-11 shrink-0">
                <Send className="h-4 w-4" aria-hidden="true" />
              </Button>
            </form>
            <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {hrs >= 1 ? `You can reply for about ${Math.floor(hrs)} more ${Math.floor(hrs) === 1 ? "hour" : "hours"}.` : "Less than an hour left to reply."} {text.length > MAX - 100 && `${MAX - text.length} characters left.`}
            </p>
          </>
        ) : (
          <div role="note" className="rounded-2xl bg-secondary/60 p-3.5 text-sm">
            <p className="font-medium">The 24-hour reply window has closed.</p>
            <p className="mt-1 text-muted-foreground">
              Meta only lets apps answer within 24 hours of {thread.participantName}&apos;s last message. You can still reply in{" "}
              <a href={appLink} target="_blank" rel="noopener noreferrer" className="underline">
                {thread.platform === "instagram" ? "the Instagram app" : "Meta Business Suite"}
              </a>
              . When they write again, you can answer here.
            </p>
          </div>
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
