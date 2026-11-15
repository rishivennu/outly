"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/shared/Sheet";
import { DateTimePicker, defaultSchedule } from "@/components/shared/DateTimePicker";
import { fmt, tzShort, useUser } from "@/components/shell/UserContext";
import { api, ApiError } from "@/lib/client/api";
import type { PostView } from "@/lib/services";

type Issue = { code: string; message: string; platform?: string };
type Conflict = { postId: string; title: string; scheduledAt: string; platform: string };
type Check = { ok: boolean; issues: Issue[]; conflicts?: Conflict[] };
type MovePost = Pick<PostView, "id" | "title" | "hook" | "status" | "scheduledAt">;

const WHEN: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

/** What the server said no to, in its own words (409 schedule_conflict, 422 platform_limit, anything else). */
export function moveError(e: unknown): { message: string; conflicts: Conflict[] } {
  if (e instanceof ApiError) {
    const conflicts = e.code === "schedule_conflict" && Array.isArray(e.data?.conflicts) ? (e.data.conflicts as Conflict[]) : [];
    return { message: e.message, conflicts };
  }
  return { message: "Couldn't move it. Check your connection and try again.", conflicts: [] };
}

/**
 * P2: pick a time, let the server check it (GET /api/posts/[id]/check), confirm with anything it found, then save.
 * Used by the calendar's Move (and drag and drop, which opens straight on the check) and by PostSheet's Reschedule.
 */
export function MovePanel({ post, initial, onSaved, onCancel, checkFirst = false }: { post: MovePost; initial: Date; onSaved: (p: PostView) => void; onCancel: () => void; checkFirst?: boolean }) {
  const { timezone: tz } = useUser();
  const [when, setWhen] = useState(initial);
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ message: string; conflicts: Conflict[] } | null>(null);

  const runCheck = async (at: Date) => {
    setFailed(null);
    setNote(null);
    if (at.getTime() < Date.now() + 60_000) {
      setFailed({ message: "That time has already passed. Pick a later one.", conflicts: [] });
      setStep("pick");
      return;
    }
    setBusy(true);
    try {
      setCheck(await api<Check>(`/api/posts/${post.id}/check?at=${encodeURIComponent(at.toISOString())}`));
    } catch (e) {
      // Saving runs the same checks, so a check that could not run never blocks the move.
      setCheck(null);
      setNote(e instanceof ApiError && e.status < 500 && e.status !== 404 ? e.message : "Couldn't check this time first. Saving still runs every check.");
    } finally {
      setBusy(false);
      setStep("confirm");
    }
  };
  // A drop already picked the time: go straight to the check (once per panel).
  useEffect(() => {
    if (checkFirst) void runCheck(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const r = await api<{ post: PostView }>(`/api/posts/${post.id}`, { method: "PATCH", json: { scheduledAt: when.toISOString() } });
      onSaved(r.post);
    } catch (e) {
      setFailed(moveError(e));
    } finally {
      setBusy(false);
    }
  };

  const blocking = !!check && check.issues.length > 0;
  const conflicts = failed?.conflicts.length ? failed.conflicts : (check?.conflicts ?? []);

  return (
    <div className="space-y-5">
      {step === "pick" ? (
        <>
          <DateTimePicker value={when} onChange={setWhen} tz={tz} />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Back
            </Button>
            <Button variant="lime" className="flex-1" onClick={() => runCheck(when)} disabled={busy}>
              <CalendarClock className="h-4 w-4" aria-hidden="true" /> {busy ? "Checking…" : "Check this time"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-2xl bg-secondary/50 p-4 hairline">
            <p className="text-sm text-muted-foreground">{post.scheduledAt ? `From ${fmt(post.scheduledAt, tz, WHEN)}` : "No time yet"}</p>
            <p className="mt-1 text-base font-semibold tabular-nums">
              To {fmt(when, tz, WHEN)} <span className="text-sm font-medium text-muted-foreground">{tzShort(tz)}</span>
            </p>
            {post.status === "draft" && <p className="mt-2 text-xs text-muted-foreground">It stays a draft with this time. Launch it from Edit to book it.</p>}
          </div>
          {busy && !check && !note && <p className="text-sm text-muted-foreground" aria-live="polite">Checking the time with your other posts and each platform&rsquo;s rules…</p>}
          {check?.ok && !failed && <p className="text-sm text-muted-foreground">No clashes and nothing against the platform rules.</p>}
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
          {(blocking || failed) && (
            <div role="alert" className="space-y-2 rounded-2xl bg-warning/10 p-4 text-sm hairline">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {failed ? "It wasn't moved" : "This time won't work"}
              </p>
              <ul className="space-y-1 text-foreground">
                {failed ? <li>{failed.message}</li> : check!.issues.map((i, n) => <li key={n}>{i.message}</li>)}
              </ul>
              {conflicts.length > 0 && (
                <ul className="space-y-1 text-muted-foreground" aria-label="Already booked near this time">
                  {conflicts.map((c) => (
                    <li key={`${c.postId}-${c.platform}`} className="tabular-nums">
                      {c.title || "Untitled"}: {fmt(c.scheduledAt, tz, { hour: "numeric", minute: "2-digit" })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2">
            <Button variant="lime" onClick={save} disabled={busy || blocking}>
              {busy && check ? "Saving…" : post.status === "draft" ? "Save this time" : "Move it"}
            </Button>
            <Button variant="subtle" onClick={() => setStep("pick")} disabled={busy}>
              Change the time
            </Button>
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Keep it where it is
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** The calendar's own Move sheet. `at` set: a drop, so it opens on the check for that time. */
export function MoveDialog({ post, at, onClose, onMoved }: { post: MovePost | null; at: Date | null; onClose: () => void; onMoved: (p: PostView) => void }) {
  const { timezone: tz } = useUser();
  const id = post?.id;
  const booked = post?.scheduledAt;
  const start = useMemo(() => (id ? (at ?? (booked ? new Date(booked) : defaultSchedule(tz))) : null), [id, at, booked, tz]);
  return (
    <Sheet open={!!post} onOpenChange={(o) => !o && onClose()} title={post ? `Move \u201c${post.title ?? post.hook?.split("\n")[0] ?? "Untitled"}\u201d` : ""} description={`Times are in ${tzShort(tz)}.`}>
      {post && start && <MovePanel key={`${post.id}:${+start}`} post={post} initial={start} checkFirst={!!at} onSaved={onMoved} onCancel={onClose} />}
    </Sheet>
  );
}
