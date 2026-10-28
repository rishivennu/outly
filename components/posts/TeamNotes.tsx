"use client";
import { useEffect, useState } from "react";
import { Check, MessageSquare, MessageSquareWarning, PenLine, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { fmt, useUser } from "@/components/shell/UserContext";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { PostView } from "@/lib/services";
import type { NoteView } from "@/lib/collab";

const ICON = { comment: MessageSquare, edit: PenLine, approved: Check, changes: MessageSquareWarning } as const;

/**
 * Draft collaboration (1037): who changed what, comments, and an approve / ask-for-changes decision from
 * inside the team. Editors can comment but not approve; nobody approves their own latest edit. Any edit after
 * an approval needs a fresh one, so what goes out is always the version someone signed off.
 */
export function TeamNotes({ post, onChange }: { post: PostView; onChange: (p: PostView) => void }) {
  const toast = useToast();
  const { timezone: tz, workspace } = useUser();
  const [notes, setNotes] = useState<NoteView[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const settled = post.status === "published" || post.status === "publishing";
  const canDecide = workspace?.role !== "editor" && !settled;

  useEffect(() => {
    let alive = true;
    setNotes(null);
    api<{ notes: NoteView[] }>(`/api/posts/${post.id}/notes`).then((r) => alive && setNotes(r.notes), () => alive && setNotes([]));
    return () => {
      alive = false;
    };
  }, [post.id, post.editedAt]);

  const comment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy("comment");
    try {
      const r = await api<{ notes: NoteView[] }>(`/api/posts/${post.id}/notes`, { method: "POST", json: { body: text.trim() } });
      setNotes(r.notes);
      setText("");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't post that comment.", "error");
    } finally {
      setBusy(null);
    }
  };
  const decide = async (decision: "approved" | "changes_requested") => {
    if (decision === "changes_requested" && !text.trim()) return toast("Write what should change in the box first.", "info");
    setBusy(decision);
    try {
      const r = await api<{ post: PostView; notes: NoteView[] }>(`/api/posts/${post.id}/approve`, { method: "POST", json: { decision, note: text.trim() || null } });
      setNotes(r.notes);
      setText("");
      onChange(r.post);
      toast(decision === "approved" ? "Approved. It can go out on schedule." : "Sent back with your note.");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't save that decision.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby={`notes-${post.id}`} className="rounded-2xl bg-secondary/40 p-4 hairline">
      <h3 id={`notes-${post.id}`} className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="h-4 w-4" aria-hidden="true" /> Team notes
      </h3>
      {post.editedBy && post.editedAt && (
        <p className="mt-1 text-xs text-muted-foreground">
          Last edited by {post.editedBy}, {fmt(post.editedAt, tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          {post.requireApproval && !post.approved ? ". Needs approval for this version." : "."}
        </p>
      )}
      {notes === null ? (
        <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">Loading notes...</p>
      ) : notes.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No notes yet. Leave one for whoever picks this up next.</p>
      ) : (
        <ol className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1" aria-label="Activity">
          {notes.map((n) => {
            const I = ICON[n.kind];
            return (
              <li key={n.id} className={cn("flex gap-2.5 rounded-xl p-2.5 text-sm", n.kind === "comment" ? "bg-background/60" : "")}>
                <I className={cn("mt-0.5 h-4 w-4 shrink-0", n.kind === "approved" ? "text-success" : n.kind === "changes" ? "text-warning" : "text-muted-foreground")} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{n.mine ? "You" : n.authorName}</span> · {fmt(n.createdAt, tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{n.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {!settled && (
        <form onSubmit={comment} className="mt-3">
          <label htmlFor={`note-${post.id}`} className="sr-only">Write a note</label>
          <textarea id={`note-${post.id}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={2} placeholder="Add a comment, or what should change" className="w-full resize-y rounded-xl bg-background/70 p-3 text-sm hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="submit" variant="subtle" disabled={!!busy || !text.trim()}>
              <Send className="h-4 w-4" aria-hidden="true" /> Comment
            </Button>
            {canDecide && (
              <>
                <Button type="button" variant="lime" onClick={() => decide("approved")} disabled={!!busy || (post.approved && !post.requireApproval)}>
                  <Check className="h-4 w-4" aria-hidden="true" /> Approve
                </Button>
                <Button type="button" variant="ghost" onClick={() => decide("changes_requested")} disabled={!!busy}>
                  <MessageSquareWarning className="h-4 w-4" aria-hidden="true" /> Ask for changes
                </Button>
              </>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
