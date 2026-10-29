"use client";
import { useRef, useState } from "react";
import { ExternalLink, Lightbulb, MessagesSquare, RefreshCw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { useToast } from "@/components/shared/Toast";
import { targetErrorCopy } from "@/components/shared/errorCopy";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { cn } from "@/lib/utils";
import type { InboxComment, InboxProblem } from "@/lib/inbox";
import { MessagesView, type DmData } from "./MessagesView";

type Data = { comments: InboxComment[]; errors: InboxProblem[]; targets: number };

type Tab = "comments" | "messages";

/** One list across every platform. Newest first, replies inline, failures stated plainly. Messages (1031) sit in their own tab. */
export function InboxView({ initial, dms, initialTab = "comments" }: { initial: Data; dms?: DmData; initialTab?: Tab }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(dms ? initialTab : "comments");
  const unread = dms?.threads.reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0) ?? 0;
  const pickTab = (t: Tab) => {
    setTab(t);
    const u = new URL(window.location.href);
    if (t === "messages") u.searchParams.set("tab", "messages");
    else u.searchParams.delete("tab");
    window.history.replaceState(null, "", u.toString());
  };
  const [data, setData] = useState<Data>(initial);
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const live = useLivePlatforms();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (p: Platform | "all") => {
    setPlatform(p);
    setLoading(true);
    setError(null);
    try {
      setData(await api<Data>(`/api/inbox${p === "all" ? "" : `?platform=${p}`}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "We couldn't reach your comments just now.");
    } finally {
      setLoading(false);
    }
  };

  const onReplied = (commentId: string, reply: InboxComment) => {
    setData((d) => ({ ...d, comments: d.comments.map((c) => (c.id === commentId ? { ...c, replies: [...(c.replies ?? []), reply] } : c)) }));
    toast("Reply sent.");
  };

  return (
    <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14">
      <p className="eyebrow mb-3">Inbox</p>
      <h1 className="display max-w-3xl text-[clamp(2.6rem,6vw,4.6rem)]">{tab === "messages" ? "Everyone who wrote to you." : "Everyone who replied."}</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        {tab === "messages"
          ? "Direct messages to your Instagram account and Facebook Page, newest first. Meta lets you answer here for 24 hours after someone's last message."
          : "Comments from your connected Instagram and YouTube accounts, plus every post you published here, newest first. Reply without leaving Outlly."}
      </p>

      {dms && (
        <div role="tablist" aria-label="Inbox" className="mt-8 inline-flex rounded-full bg-secondary/50 p-1 hairline">
          {(["comments", "messages"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              id={`inbox-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`inbox-panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => pickTab(t)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  const next = t === "comments" ? "messages" : "comments";
                  pickTab(next);
                  document.getElementById(`inbox-tab-${next}`)?.focus();
                }
              }}
              className={cn("inline-flex h-11 items-center gap-2 rounded-full px-5 text-[13.5px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring", tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {t === "comments" ? "Comments" : "Messages"}
              {t === "messages" && unread > 0 && (
                <span className="rounded-full bg-lime px-1.5 text-[11px] font-semibold text-lime-ink" aria-label={`${unread} unread`}>
                  {unread}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {tab === "messages" && dms ? (
        <div role="tabpanel" id="inbox-panel-messages" aria-labelledby="inbox-tab-messages">
          <MessagesView initial={dms} />
        </div>
      ) : (
      <div role={dms ? "tabpanel" : undefined} id="inbox-panel-comments" aria-labelledby={dms ? "inbox-tab-comments" : undefined}>
      <div className="mt-8 flex flex-wrap items-center gap-2">
        {(["all", ...live] as const).map((p) => (
          <button
            key={p}
            onClick={() => load(p)}
            aria-pressed={platform === p}
            className={cn("h-10 rounded-full px-4 text-[13px] font-medium transition hairline", platform === p ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60")}
          >
            {p === "all" ? "Everything" : PLATFORM_META[p].name}
          </button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => load(platform)} disabled={loading} className="ml-auto">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> {loading ? "Checking…" : "Refresh"}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      )}

      {data.errors.length > 0 && (
        <ul className="mt-6 space-y-2">
          {groupProblems(data.errors).map((g) => {
            const copy = targetErrorCopy(g.platform, g.code);
            const titles = g.items.map((e) => e.postTitle).filter(Boolean) as string[];
            const details = Array.from(new Set(g.items.map((e) => e.detail).filter(Boolean))) as string[];
            return (
              <li key={`${g.platform}-${g.code}`} className="rounded-2xl bg-destructive/10 p-4 text-sm">
                <p className="font-medium text-destructive">{copy.title}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {g.items.length === 1
                    ? `${PLATFORM_META[g.platform].name}${titles[0] ? ` · ${titles[0]}` : ""}`
                    : `${g.items.length} ${PLATFORM_META[g.platform].name} posts`}.{" "}
                  We didn&apos;t show anything rather than guess.
                </p>
                {g.items[0].hint && <p className="mt-2 text-foreground/85">{g.items[0].hint}</p>}
                {(g.items.length > 1 || details.length > 0) && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">{g.items.length > 1 ? "Which posts" : "What the platform said"}</summary>
                    {g.items.length > 1 && (
                      <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                        {Array.from(new Set(titles)).map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    )}
                    {details.map((d) => (
                      <pre key={d} className="mt-1 whitespace-pre-wrap break-all text-[11px] text-muted-foreground">{d}</pre>
                    ))}
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {data.comments.length === 0 ? (
        <div className="mt-10 rounded-[28px] bg-secondary/40 p-10 text-center hairline">
          <MessagesSquare className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.6} />
          <p className="mt-3 font-medium">{data.targets === 0 ? "No comments to show yet." : "No comments yet."}</p>
          <p className="mt-1 text-sm text-muted-foreground">{data.targets === 0 ? "Connect an account on the Accounts page and comments on your recent posts land here." : "We checked your recent posts on every connected account. Give it time."}</p>
        </div>
      ) : (
        <ul className="mt-8 max-w-3xl space-y-3">
          {data.comments.map((c) => (
            <CommentRow key={`${c.targetId}-${c.id}`} comment={c} onReplied={onReplied} />
          ))}
        </ul>
      )}
      </div>
      )}
    </div>
  );
}

function CommentRow({ comment, onReplied }: { comment: InboxComment; onReplied: (id: string, reply: InboxComment) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [ideas, setIdeas] = useState<{ label: string; text: string }[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();

  // A question in the comments is often the next video. Keep it in the idea bank on Home.
  const saveIdea = async () => {
    try {
      const r = await api<{ existed?: boolean }>("/api/ideas", { method: "POST", json: { text: `Answer ${comment.authorName}: ${comment.text}`.slice(0, 500), source: "comment", sourceRef: `${comment.platform}:${comment.id}`.slice(0, 300) } });
      setSaved(true);
      toast(r.existed ? "Already in your idea bank" : "Saved to your idea bank on Home", "ok");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't save it", "error");
    }
  };

  const suggest = async () => {
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
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ reply: InboxComment; repliesLeft?: number | null }>("/api/inbox/reply", { method: "POST", json: { targetId: comment.targetId, commentId: comment.id, text: text.trim() } });
      onReplied(comment.id, { ...r.reply, targetId: comment.targetId, postId: comment.postId, platform: comment.platform, postTitle: comment.postTitle, postUrl: comment.postUrl });
      setText("");
      setIdeas(null);
      setLeft(typeof r.repliesLeft === "number" ? r.repliesLeft : null);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "The reply didn't go through. Let's try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-[24px] bg-secondary/40 p-4 hairline">
      <div className="flex items-start gap-3">
        <PlatformOrb platform={comment.platform} size={30} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {comment.authorName}
            <span className="text-xs font-normal text-muted-foreground">{new Date(comment.createdAt).toLocaleString()}</span>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[15px]">{comment.text}</p>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="min-w-0 max-w-full truncate">on {comment.postTitle ?? "a post"}</span>
            {comment.postUrl && (
              <a href={comment.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 underline">
                Open <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <button type="button" onClick={saveIdea} disabled={saved} aria-label={saved ? "Saved as an idea" : `Save ${comment.authorName}'s comment as a video idea`} className="ml-auto inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full px-3 font-medium text-foreground hover:bg-secondary disabled:text-muted-foreground">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> {saved ? "Saved" : "Save as idea"}
            </button>
          </p>

          {(comment.replies ?? []).length > 0 && (
            <ul className="mt-3 space-y-2 border-l-2 border-foreground/10 pl-3">
              {comment.replies!.map((r) => (
                <li key={r.id} className="text-sm">
                  <span className="font-medium">{r.authorName}</span> <span className="whitespace-pre-wrap">{r.text}</span>
                </li>
              ))}
            </ul>
          )}

          {thinking && (
            <div className="mt-3" role="status" aria-label="Writing reply ideas">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-lime-ink dark:text-lime">
                <Sparkles className="ai-orb-icon is-on h-3 w-3" aria-hidden="true" /> Writing reply ideas…
              </p>
              <ul className="flex flex-col gap-1.5" aria-hidden="true">
                {[88, 72, 80].map((w, i) => <li key={i} className="ai-shimmer h-10 rounded-2xl" style={{ width: `${w}%`, ["--i" as string]: i }} />)}
              </ul>
            </div>
          )}
          {ideas && !thinking && (
            <div className="reply-ideas mt-3" role="group" aria-label="Suggested replies">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <Sparkles className="h-3 w-3" aria-hidden="true" /> Tap one, then make it yours
              </p>
              <ul className="flex flex-col gap-1.5">
                {ideas.map((s, i) => (
                  <li key={s.text} style={{ ["--i" as string]: i }}>
                    <button
                      type="button"
                      onClick={() => pick(s.text)}
                      aria-pressed={text === s.text}
                      className={cn(
                        "reply-idea w-full rounded-2xl px-3.5 py-2.5 text-left text-sm transition hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        text === s.text ? "bg-lime/15 text-foreground" : "bg-card text-foreground hover:bg-secondary",
                      )}
                    >
                      <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-lime-ink dark:text-lime">{s.label}</span>
                      {s.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form onSubmit={send} className="mt-3 flex min-w-0 items-center gap-2">
            <Button type="button" variant="ghost" size="icon" onClick={suggest} disabled={thinking} aria-busy={thinking} aria-label={thinking ? "Writing reply ideas" : ideas ? "More reply ideas" : "Suggest replies"} title="Suggest replies" data-thinking={thinking ? "" : undefined} className="ai-orb shrink-0 disabled:opacity-100">
              <Sparkles className="ai-orb-icon h-4 w-4" aria-hidden="true" />
            </Button>
            <Input ref={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Write a reply…" aria-label={`Reply to ${comment.authorName}`} className="h-11 min-w-0 flex-1 text-base sm:text-sm" />
            {/* shrink-0: the field takes the squeeze on a phone, the send button stays a 44px circle (1044) */}
            <Button type="submit" variant="lime" size="icon" disabled={busy || !text.trim()} aria-label="Send reply" className="shrink-0">
              <Send className="h-4 w-4" />
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
        </div>
      </div>
    </li>
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
