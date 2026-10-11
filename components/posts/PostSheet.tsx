"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, Copy, ExternalLink, Link as LinkIcon, MessageSquareWarning, PenLine, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/shared/Sheet";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DateTimePicker, defaultSchedule } from "@/components/shared/DateTimePicker";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { useToast } from "@/components/shared/Toast";
import { fmt, tzShort, useUser } from "@/components/shell/UserContext";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORM_META, TARGET_COPY, type TargetStatus } from "@/lib/domain";
import { targetErrorCopy } from "@/components/shared/errorCopy";
import { PracticePill } from "@/components/shared/PracticePill";
import type { PostView } from "@/lib/services";

interface Props {
  post: PostView | null;
  onClose: () => void;
  onChange: (p: PostView) => void;
  onRemove: (id: string) => void;
  onDuplicate: (p: PostView) => void;
}

/** Floating detail panel shared by Content and Calendar. Edit / Reschedule / Duplicate / Remove. */
export function PostSheet({ post, onClose, onChange, onRemove, onDuplicate }: Props) {
  const { timezone: tz } = useUser();
  const toast = useToast();
  const [view, setView] = useState<"detail" | "reschedule" | "remove">("detail");
  const [when, setWhen] = useState<Date>(() => defaultSchedule(tz));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setView("detail");
    setError(null);
    setWhen(post?.scheduledAt ? new Date(post.scheduledAt) : defaultSchedule(tz));
  }, [post?.id, post?.scheduledAt, tz]);

  if (!post) return <Sheet open={false} onOpenChange={() => {}} title="">{null}</Sheet>;

  const editable = post.status === "draft" || post.status === "scheduled";
  const needsHand = post.status === "failed" || post.status === "partial";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something got in the way. Let's try again.");
    } finally {
      setBusy(false);
    }
  };

  const reschedule = () =>
    run(async () => {
      const r = await api<{ post: PostView }>(`/api/posts/${post.id}`, { method: "PATCH", json: { scheduledAt: when.toISOString() } });
      onChange(r.post);
      setView("detail");
      toast("It's on the calendar. 🗓️");
    });

  const duplicate = () =>
    run(async () => {
      const r = await api<{ post: PostView }>(`/api/posts/${post.id}/duplicate`, { method: "POST" });
      onDuplicate(r.post);
      toast("Made a copy. It's in your drafts.");
    });

  const remove = () =>
    run(async () => {
      await api(`/api/posts/${post.id}`, { method: "DELETE" });
      onRemove(post.id);
      toast("Removed.", "info");
      onClose();
    });

  const title = post.title ?? post.hook?.split("\n")[0] ?? "Untitled idea";

  return (
    <Sheet open={!!post} onOpenChange={(o) => !o && onClose()} title={view === "reschedule" ? "When should this go live?" : view === "remove" ? "Remove this?" : title} description={view === "reschedule" ? `Times are in ${tzShort(tz)}.` : undefined}>
      {view === "detail" && (
        <div className="space-y-6">
          <div className="flex gap-4">
            <div className="relative aspect-[9/16] w-24 shrink-0 overflow-hidden rounded-2xl bg-secondary hairline">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {post.media.thumbnailUrl && <img src={post.media.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 space-y-2 py-1">
              <StatusBadge status={post.status} />
              {post.scheduledAt && post.status === "scheduled" && (
                <p className="text-sm">
                  Goes live <span className="font-semibold">{fmt(post.scheduledAt, tz, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </p>
              )}
              {post.publishedAt && <p className="text-sm text-muted-foreground">Went out {fmt(post.publishedAt, tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>}
              {post.hook && <p className="line-clamp-3 text-sm text-muted-foreground">{post.hook}</p>}
            </div>
          </div>

          <ul className="space-y-2">
            {post.targets.map((t) => {
              const h = t.status === "failed" ? targetErrorCopy(t.platform, t.errorCode) : null;
              return (
                <li key={t.id} className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-3">
                  <PlatformOrb platform={t.platform} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">
                        {PLATFORM_META[t.platform].name} <span className="text-muted-foreground">{PLATFORM_META[t.platform].format}</span>
                      </span>
                      {t.practice && <PracticePill />}
                    </p>
                    <p className={h ? "text-xs text-destructive" : "truncate text-xs text-muted-foreground"}>{h ? h.title : t.status === "published" ? (t.url ? "Published" : "Practice run — nothing was posted") : t.status === "pending" ? (post.status === "scheduled" ? "Waiting for its moment" : "Not sent yet") : TARGET_COPY[t.status as TargetStatus]}</p>
                  </div>
                  {t.url && (
                    <a href={t.url} target="_blank" rel="noopener noreferrer" aria-label={`Open on ${PLATFORM_META[t.platform].name} (new tab)`} className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>

          <ReviewBlock post={post} onChange={onChange} />

          <div className="grid grid-cols-2 gap-2">
            {editable && (
              <Button asChild variant="primary">
                <Link href={`/create?post=${post.id}`}>
                  <PenLine className="h-4 w-4" /> Edit
                </Link>
              </Button>
            )}
            {needsHand && (
              <Button asChild variant="primary">
                <Link href={`/create?post=${post.id}`}>
                  <Wrench className="h-4 w-4" /> Fix it
                </Link>
              </Button>
            )}
            {editable && (
              <Button variant="subtle" onClick={() => setView("reschedule")}>
                <CalendarClock className="h-4 w-4" /> {post.status === "scheduled" ? "Reschedule" : "Set a time"}
              </Button>
            )}
            <Button variant="subtle" onClick={duplicate} disabled={busy}>
              <Copy className="h-4 w-4" /> Duplicate
            </Button>
            {post.status !== "publishing" && (
              <Button variant="danger" onClick={() => setView("remove")}>
                <Trash2 className="h-4 w-4" /> Remove this
              </Button>
            )}
          </div>
          {post.status === "draft" && <p className="text-xs text-muted-foreground">Setting a time saves it with the draft. It goes on the calendar once you launch it from Edit.</p>}
        </div>
      )}

      {view === "reschedule" && (
        <div>
          <DateTimePicker value={when} onChange={setWhen} tz={tz} />
          <div className="mt-6 flex gap-2">
            <Button variant="ghost" onClick={() => setView("detail")}>
              Back
            </Button>
            <Button variant="lime" className="flex-1" onClick={reschedule} disabled={busy}>
              {busy ? "Saving…" : "Schedule it"}
            </Button>
          </div>
        </div>
      )}

      {view === "remove" && (
        <div className="space-y-6">
          <p className="text-muted-foreground">{post.status === "published" ? "This removes it from your studio. Posts already live on each platform stay up." : "This removes it and all its copy from your studio."}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setView("detail")}>
              Keep it
            </Button>
            <Button variant="danger" className="flex-1" onClick={remove} disabled={busy}>
              <Trash2 className="h-4 w-4" /> {busy ? "Removing…" : "Yes, remove it"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
    </Sheet>
  );
}

/**
 * Team approval, in the one place a post lives. The token is shown once (when the link is created)
 * and never again: the server only keeps its hash.
 */
function ReviewBlock({ post, onChange }: { post: PostView; onChange: (p: PostView) => void }) {
  const toast = useToast();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const review = post.review;
  const settled = post.status === "published" || post.status === "publishing";

  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ url: string; post: PostView }>(`/api/posts/${post.id}/review`, { method: "POST" });
      setLink(r.url);
      onChange(r.post);
      await copy(r.url);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't make a review link. Let's try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Review link copied. Paste it wherever your team talks.");
    } catch {
      toast("Couldn't reach the clipboard — the link is on screen, copy it by hand.", "info");
    }
  };

  const toggle = async (on: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ post: PostView }>(`/api/posts/${post.id}`, { method: "PATCH", json: { requireApproval: on } });
      onChange(r.post);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="review-h" className="rounded-2xl bg-secondary/40 p-4 hairline">
      <h3 id="review-h" className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4" /> Review
      </h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {!review ? (
          "Nobody has looked at this yet."
        ) : review.status === "approved" ? (
          <span className="inline-flex items-center gap-1.5 text-foreground">
            <Check className="h-4 w-4" /> Approved by {review.reviewerName ?? "a reviewer"}
          </span>
        ) : review.status === "changes_requested" ? (
          <span className="inline-flex items-center gap-1.5 text-warning">
            <MessageSquareWarning className="h-4 w-4" /> {review.reviewerName ?? "A reviewer"} asked for changes
          </span>
        ) : review.expired ? (
          "That review link expired before anyone used it."
        ) : (
          "Waiting on a reviewer."
        )}
      </p>
      {review?.note && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-background/60 p-3 text-sm">{review.note}</p>}

      {link && (
        <p className="mt-3 break-all rounded-xl bg-background/60 p-3 text-xs">
          {link}
          <span className="mt-1 block text-muted-foreground">Shown once. Copy it now.</span>
        </p>
      )}

      {!settled && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="subtle" size="sm" onClick={send} disabled={busy}>
            <LinkIcon className="h-4 w-4" /> {review ? "New review link" : "Send for review"}
          </Button>
          {link && (
            <Button variant="ghost" size="sm" onClick={() => copy(link)}>
              <Copy className="h-4 w-4" /> Copy again
            </Button>
          )}
        </div>
      )}

      <label className="mt-4 flex items-start gap-3 text-sm">
        <input type="checkbox" checked={post.requireApproval} onChange={(e) => toggle(e.target.checked)} disabled={busy || settled} className="mt-0.5 h-5 w-5 shrink-0 rounded-md" />
        <span>
          Require approval before publish
          <span className="block text-xs text-muted-foreground">
            {post.requireApproval && !post.approved ? "Publishing and scheduled sends are held until someone approves." : "Nothing is held up right now."}
          </span>
        </span>
      </label>
      {err && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {err}
        </p>
      )}
    </section>
  );
}
