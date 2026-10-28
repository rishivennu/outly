"use client";
import { useEffect, useState } from "react";
import { firstCommentLine } from "@/lib/client/first-comment";
import Link from "next/link";
import { CalendarClock, Check, Copy, Eye, EyeOff, ExternalLink, Link as LinkIcon, MessageSquareWarning, PenLine, ShieldCheck, Trash2, Wrench } from "lucide-react";
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
import type { PostView, TargetView } from "@/lib/services";
import { TeamNotes } from "./TeamNotes";

/** Live on the platform right now (hidden YouTube videos count: they still exist there). */
const isLive = (t: TargetView) => t.status === "published" && !!t.platformPostId && t.removeMode !== "deleted";

function targetLine(t: TargetView, scheduled: boolean) {
  const name = PLATFORM_META[t.platform].name;
  if (t.status === "published" && t.removeMode === "deleted") return `Deleted from ${name}`;
  if (t.status === "published" && t.removeMode === "hidden") return `Private on ${name}. Only you can see it`;
  if (t.status === "published") return "Published";
  if (t.status === "pending") return scheduled ? "Waiting for its moment" : "Not sent yet";
  return TARGET_COPY[t.status as TargetStatus];
}

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
  const [view, setView] = useState<"detail" | "reschedule" | "remove" | "takedown">("detail");
  const [takedownId, setTakedownId] = useState<string | null>(null);
  const [when, setWhen] = useState<Date>(() => defaultSchedule(tz));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setView("detail");
    setTakedownId(null);
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

  const remove = (everywhere: boolean) =>
    run(async () => {
      try {
        await api(`/api/posts/${post.id}${everywhere ? `?platforms=1${appOnly.length ? "&appOnly=ack" : ""}` : ""}`, { method: "DELETE" });
      } catch (e) {
        // Some platforms said yes before one said no: show what changed, keep the post so the rest can be retried.
        if (e instanceof ApiError && e.data?.post) onChange(e.data.post as PostView);
        throw e;
      }
      onRemove(post.id);
      toast(everywhere ? "Deleted from the platforms and your studio." : "Removed from your studio.", "info");
      onClose();
    });

  const takedownTarget = post.targets.find((t) => t.id === takedownId) ?? null;
  const takeDown = (t: TargetView, action: "delete" | "hide" | "show") =>
    run(async () => {
      const r = await api<{ post: PostView }>(`/api/targets/${t.id}/remove`, { method: "POST", json: { action } });
      onChange(r.post);
      setView("detail");
      const name = PLATFORM_META[t.platform].name;
      toast(action === "delete" ? `Deleted from ${name}.` : action === "hide" ? `Now private on ${name}.` : `Public again on ${name}.`, "info");
    });

  const live = post.targets.filter(isLive);
  const deletable = live.filter((t) => t.canDelete);
  const appOnly = live.filter((t) => !t.canDelete);

  const title = post.title ?? post.hook?.split("\n")[0] ?? "Untitled idea";

  return (
    <Sheet open={!!post} onOpenChange={(o) => !o && onClose()} title={
        view === "reschedule"
          ? "When should this go live?"
          : view === "remove"
            ? "Remove this?"
            : view === "takedown" && takedownTarget
              ? `Take it down from ${PLATFORM_META[takedownTarget.platform].name}?`
              : title
      } description={view === "reschedule" ? `Times are in ${tzShort(tz)}.` : undefined}>
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
              const fc = t.status === "failed" ? null : firstCommentLine(t);
              return (
                <li key={t.id} className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-3">
                  <PlatformOrb platform={t.platform} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">
                        {PLATFORM_META[t.platform].name} <span className="text-muted-foreground">{PLATFORM_META[t.platform].format}</span>
                      </span>
                    </p>
                    <p className={h ? "text-xs text-destructive" : "truncate text-xs text-muted-foreground"}>{h ? h.title : targetLine(t, post.status === "scheduled")}</p>
                    {fc && <p className={fc.tone === "bad" ? "mt-0.5 text-xs text-destructive" : "mt-0.5 text-xs text-muted-foreground"}>{fc.text}</p>}
                  </div>
                  {t.url && (
                    <a href={t.url} target="_blank" rel="noopener noreferrer" aria-label={`Open on ${PLATFORM_META[t.platform].name} (new tab)`} className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                  {isLive(t) && (
                    <button
                      type="button"
                      onClick={() => {
                        setTakedownId(t.id);
                        setError(null);
                        setView("takedown");
                      }}
                      aria-label={`Take down from ${PLATFORM_META[t.platform].name}`}
                      title={`Take down from ${PLATFORM_META[t.platform].name}`}
                      className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <ReviewBlock post={post} onChange={onChange} />
          <TeamNotes post={post} onChange={onChange} />

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
          {live.length === 0 ? (
            <p className="text-muted-foreground">This removes it and all its copy from your studio.</p>
          ) : (
            <>
              <p className="text-muted-foreground">
                It&rsquo;s live on {live.map((t) => PLATFORM_META[t.platform].name).join(", ")}. Choose whether it comes down there too.
              </p>
              {appOnly.length > 0 && (
                <div className="rounded-2xl bg-secondary/50 p-3 text-sm">
                  <p className="text-muted-foreground">
                    {appOnly.map((t) => PLATFORM_META[t.platform].name).join(" and ")} {appOnly.length === 1 ? "doesn't" : "don't"} let apps delete posts. Open {appOnly.length === 1 ? "it" : "each one"} and delete it in the app first. The link goes away once it&rsquo;s out of your studio.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {appOnly.map((t) =>
                      t.url ? (
                        <a key={t.id} href={t.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 font-medium hairline hover:bg-secondary">
                          Open on {PLATFORM_META[t.platform].name} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="sr-only">(new tab)</span>
                        </a>
                      ) : null,
                    )}
                  </div>
                </div>
              )}
            </>
          )}
          <div className="grid gap-2">
            {deletable.length > 0 && (
              <Button variant="danger" onClick={() => remove(true)} disabled={busy}>
                <Trash2 className="h-4 w-4" /> {busy ? "Deleting…" : `Delete from ${deletable.map((t) => PLATFORM_META[t.platform].name).join(", ")} and my studio`}
              </Button>
            )}
            <Button variant={deletable.length > 0 ? "subtle" : "danger"} onClick={() => remove(false)} disabled={busy}>
              {busy ? "Removing…" : live.length > 0 ? "Remove from my studio only (stays live)" : "Yes, remove it"}
            </Button>
            <Button variant="ghost" onClick={() => setView("detail")}>
              Keep it
            </Button>
          </div>
        </div>
      )}

      {view === "takedown" && takedownTarget && (
        <TakedownView t={takedownTarget} busy={busy} onAction={(a) => takeDown(takedownTarget, a)} onBack={() => setView("detail")} />
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
    </Sheet>
  );
}

/** One platform's live copy: delete it there, or on YouTube make it private (and public again). */
function TakedownView({ t, busy, onAction, onBack }: { t: TargetView; busy: boolean; onAction: (a: "delete" | "hide" | "show") => void; onBack: () => void }) {
  const m = PLATFORM_META[t.platform];
  if (!t.canDelete && !t.canHide)
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">
          {m.name} doesn&rsquo;t let apps delete or hide posts, so this one has to come down in the {m.name} app: open the {m.format}, tap the three dots, then Delete. It stays listed here until you remove it from your studio.
        </p>
        <div className="grid gap-2">
          {t.url && (
            <Button asChild variant="primary">
              <a href={t.url} target="_blank" rel="noopener noreferrer">
                Open on {m.name} <ExternalLink className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">(new tab)</span>
              </a>
            </Button>
          )}
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
    );
  const hidden = t.removeMode === "hidden";
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        {hidden
          ? `It's private on ${m.name} right now: only you can see it. Make it public again, or delete it for good.`
          : `Deleting removes the ${m.format} from ${m.name} for good, with its views and comments. It stays in your studio, marked deleted, so you can post it again.`}
        {!hidden && t.canHide && ` Not sure? Make it private instead: nobody else sees it, and you can bring it back any time.`}
      </p>
      <div className="grid gap-2">
        {hidden ? (
          <Button variant="primary" onClick={() => onAction("show")} disabled={busy}>
            <Eye className="h-4 w-4" aria-hidden="true" /> {busy ? "Working…" : "Make it public again"}
          </Button>
        ) : (
          t.canHide && (
            <Button variant="subtle" onClick={() => onAction("hide")} disabled={busy}>
              <EyeOff className="h-4 w-4" aria-hidden="true" /> {busy ? "Working…" : "Make it private"}
            </Button>
          )
        )}
        {t.canDelete && (
          <Button variant="danger" onClick={() => onAction("delete")} disabled={busy}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> {busy ? "Deleting…" : `Delete from ${m.name}`}
          </Button>
        )}
        <Button variant="ghost" onClick={onBack}>
          Keep it
        </Button>
      </div>
    </div>
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
      toast("Couldn't reach the clipboard. The link is on screen, so copy it by hand.", "info");
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
