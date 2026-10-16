"use client";
import { useState } from "react";
import { CheckCircle2, Clock, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORM_META } from "@/lib/domain";
import type { ReviewPackage, ReviewView } from "@/lib/review";

/** The reviewer is not signed in: everything they can do is on this page, and they can do it once. */
export function ReviewPage({ token, data }: { token: string; data: ReviewPackage }) {
  const [review, setReview] = useState<ReviewView>(data.review);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = review.status === "pending" && !review.expired;

  const decide = async (decision: "approved" | "changes_requested") => {
    setError(null);
    if (!name.trim()) return setError("Please add your name so they know who looked.");
    if (decision === "changes_requested" && !note.trim()) return setError("Tell them what to change.");
    setBusy(true);
    try {
      const r = await api<{ review: ReviewView }>(`/api/review/${token}`, {
        method: "POST",
        json: { reviewerName: name.trim(), decision, note: note.trim() || undefined },
      });
      setReview(r.review);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something got in the way. Let's try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-[clamp(1.8rem,4vw,2.6rem)] font-semibold tracking-tight">{data.creatorName} wants your eyes on this.</h1>
      <p className="mt-2 text-muted-foreground">
        {data.post.title ?? data.post.hook?.split("\n")[0] ?? "Untitled idea"}
        {data.post.scheduledAt && <> · planned for {new Date(data.post.scheduledAt).toLocaleString()}</>}
      </p>

      <div className="mt-8 flex flex-col gap-6 sm:flex-row">
        <div className="relative aspect-[9/16] w-full max-w-[220px] shrink-0 overflow-hidden rounded-3xl bg-secondary hairline">
          {data.post.media.url ? (
            <video src={data.post.media.url} poster={data.post.media.thumbnailUrl ?? undefined} controls playsInline className="h-full w-full object-cover" />
          ) : data.post.media.thumbnailUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={data.post.media.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <p className="grid h-full place-items-center p-4 text-center text-xs text-muted-foreground">The video preview isn&apos;t available on this link.</p>
          )}
        </div>
        <ul className="min-w-0 flex-1 space-y-3">
          {data.post.targets.map((t) => (
            <li key={t.id} className="rounded-2xl bg-secondary/50 p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <PlatformOrb platform={t.platform} size={26} />
                {PLATFORM_META[t.platform].name} <span className="text-muted-foreground">{PLATFORM_META[t.platform].format}</span>
              </p>
              {t.title && <p className="mt-2 text-sm font-semibold">{t.title}</p>}
              {(t.caption || t.description) && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{t.caption ?? t.description}</p>}
              {t.hashtags && <p className="mt-1 text-sm text-muted-foreground">{t.hashtags}</p>}
            </li>
          ))}
          {data.post.targets.length === 0 && <li className="text-sm text-muted-foreground">No destinations picked yet.</li>}
        </ul>
      </div>

      <div className="glass mt-10 rounded-[28px] p-6">
        {!open ? (
          <Done review={review} />
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="rname">Your name</Label>
              <Input id="rname" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Who's looking?" autoComplete="name" />
            </div>
            {asking && (
              <div>
                <Label htmlFor="rnote">What should change?</Label>
                <Textarea id="rnote" value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={2000} placeholder="Be specific, they only get this one note." />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="lime" onClick={() => decide("approved")} disabled={busy}>
                <CheckCircle2 className="h-4 w-4" /> {busy ? "Sending…" : "Approve"}
              </Button>
              {asking ? (
                <Button variant="primary" onClick={() => decide("changes_requested")} disabled={busy}>
                  <MessageSquareWarning className="h-4 w-4" /> Send these changes
                </Button>
              ) : (
                <Button variant="subtle" onClick={() => setAsking(true)} disabled={busy}>
                  <MessageSquareWarning className="h-4 w-4" /> Request changes
                </Button>
              )}
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> This link works once, and expires {new Date(review.expiresAt).toLocaleDateString()}.
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Done({ review }: { review: ReviewView }) {
  if (review.status === "pending" && review.expired)
    return (
      <div>
        <h2 className="text-lg font-semibold">This link has expired.</h2>
        <p className="mt-1 text-sm text-muted-foreground">Review links last a week. Ask for a fresh one and nothing is lost.</p>
      </div>
    );
  return (
    <div>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {review.status === "approved" ? <CheckCircle2 className="h-5 w-5" /> : <MessageSquareWarning className="h-5 w-5" />}
        {review.status === "approved" ? "Approved. Thank you." : "Changes sent."}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {review.reviewerName ? `${review.reviewerName} ` : "Someone "}
        {review.status === "approved" ? "approved this" : "asked for changes"}
        {review.decidedAt ? ` on ${new Date(review.decidedAt).toLocaleString()}` : ""}. A link carries one decision, so there is nothing more to do here.
      </p>
      {review.note && <p className="mt-3 whitespace-pre-wrap rounded-2xl bg-secondary/50 p-4 text-sm">{review.note}</p>}
    </div>
  );
}
