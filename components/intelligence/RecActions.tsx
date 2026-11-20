"use client";
import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/client/api";
import { NOTE_MAX } from "@/lib/intelligence/planner-core";
import { cn } from "@/lib/utils";
import { REC_STATUS_AFTER, createHref, recControls, type RecMove } from "./view-core";

/**
 * R1248: the Growth Planner's buttons on a dashboard card. Only the legal moves of the card's status are shown
 * (recControls, from planner-core's transitions). The status word changes at once; a refusal from the server
 * (400 or 409) puts the old status back and says why. Edit lives in Content Studio, not here.
 */
const btn =
  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium hairline transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60";
const quiet = cn(btn, "bg-secondary hover:bg-secondary/70");

export interface RecActionsViewProps {
  id: string;
  status: string;
  confirming: boolean;
  feedbackGiven: boolean;
  pending: boolean;
  error: string | null;
  thanks: boolean;
  note: string;
  onMove: (m: RecMove) => void;
  onAskReject: () => void;
  onCancelReject: () => void;
  onNote: (v: string) => void;
  onFeedback: (helpful: boolean) => void;
}

export function RecActionsView(p: RecActionsViewProps) {
  const controls = recControls(p.status, { confirming: p.confirming, feedbackGiven: p.feedbackGiven });
  const href = createHref(p.id);
  const has = (c: (typeof controls)[number]) => controls.includes(c);
  return (
    <div className="mt-3 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {has("create") && href && (
          <Link href={href} className={quiet}>
            Create from this
          </Link>
        )}
        {has("save") && (
          <button type="button" className={quiet} disabled={p.pending} onClick={() => p.onMove("save")}>
            Save for later
          </button>
        )}
        {has("done") && (
          <button type="button" className={quiet} disabled={p.pending} onClick={() => p.onMove("done")}>
            Mark done
          </button>
        )}
        {has("reject") && (
          <button type="button" className={quiet} disabled={p.pending} onClick={p.onAskReject}>
            Not for me
          </button>
        )}
        {has("reject-confirm") && (
          <span role="group" aria-label="Confirm not for me" className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium">Hide this one for good?</span>
            <button type="button" className={cn(btn, "bg-destructive/10 text-destructive hover:bg-destructive/15")} disabled={p.pending} onClick={() => p.onMove("reject")}>
              Yes, not for me
            </button>
            <button type="button" className={quiet} disabled={p.pending} onClick={p.onCancelReject}>
              Keep it
            </button>
          </span>
        )}
      </div>
      {has("feedback") && (
        <div role="group" aria-label="Feedback on this recommendation" className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted-foreground">Was this helpful?</span>
          <input
            type="text"
            value={p.note}
            maxLength={NOTE_MAX}
            onChange={(e) => p.onNote(e.target.value)}
            placeholder="Optional note"
            aria-label={`Optional note, up to ${NOTE_MAX} characters`}
            className="min-h-11 min-w-0 flex-1 rounded-full bg-background/70 px-4 text-sm hairline focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          />
          <button type="button" className={quiet} disabled={p.pending} onClick={() => p.onFeedback(true)}>
            Yes
          </button>
          <button type="button" className={quiet} disabled={p.pending} onClick={() => p.onFeedback(false)}>
            No
          </button>
        </div>
      )}
      {p.thanks && <p className="text-[13px] text-muted-foreground" role="status">Thanks, your feedback is saved.</p>}
      {p.error && (
        <p className="rounded-2xl bg-destructive/10 p-3 text-[13px] font-medium text-destructive hairline" role="alert">
          {p.error}
        </p>
      )}
    </div>
  );
}

type ActAnswer = { recommendation: { status: string } };

export function RecActions({ id, status, hadFeedback, onStatus }: { id: string; status: string; hadFeedback: boolean; onStatus: (s: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState(hadFeedback);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const [note, setNote] = useState("");

  const send = (action: string, payload?: unknown) => api<ActAnswer>(`/api/recommendations/${encodeURIComponent(id)}`, { method: "POST", json: { action, payload } });
  const message = (err: unknown) => (err instanceof ApiError ? err.message : "That didn't save. Try again in a moment.");

  const onMove = async (m: RecMove) => {
    const before = status;
    setPending(true);
    setError(null);
    setConfirming(false);
    onStatus(REC_STATUS_AFTER[m]);
    try {
      const r = await send(m);
      onStatus(r.recommendation.status);
    } catch (err) {
      // An expired row was marked expired by the server on the way: showing it as such is the truth, not a revert.
      onStatus(err instanceof ApiError && err.code === "EXPIRED" ? "expired" : before);
      setError(message(err));
    } finally {
      setPending(false);
    }
  };

  const onFeedback = async (helpful: boolean) => {
    setPending(true);
    setError(null);
    setFeedbackGiven(true);
    try {
      await send("feedback", { helpful, note: note.trim() || null });
      setThanks(true);
    } catch (err) {
      // Already given (409) stays given; any other refusal hands the row back.
      if (!(err instanceof ApiError && err.code === "FEEDBACK_GIVEN")) setFeedbackGiven(false);
      setError(message(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <RecActionsView
      id={id}
      status={status}
      confirming={confirming}
      feedbackGiven={feedbackGiven}
      pending={pending}
      error={error}
      thanks={thanks}
      note={note}
      onMove={(m) => void onMove(m)}
      onAskReject={() => setConfirming(true)}
      onCancelReject={() => setConfirming(false)}
      onNote={setNote}
      onFeedback={(h) => void onFeedback(h)}
    />
  );
}
