"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { Card, CardTitle, fmtDate } from "@/components/admin/ui";

export type PartnerNoteRow = { id: string; author: string; body: string; createdAt: string };

/** Internal notes. They live only here: never in an email, a creator page or an API the creator can call. */
export default function NotesPanel({ id, notes: initial }: { id: string; notes: PartnerNoteRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [notes, setNotes] = useState(initial);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) {
      setError("Write the note first.");
      document.getElementById("pa-note")?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = await adminApi<{ note: PartnerNoteRow }>(`/api/admin/partners/${id}/notes`, { method: "POST", json: { body } });
      setNotes((n) => [r.note, ...n]);
      setBody("");
      toast("Note added.");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card aria-labelledby="pa-notes-h">
      <CardTitle hint={<span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" aria-hidden />Internal. Never shown to the creator.</span>}>
        <span id="pa-notes-h">Internal notes</span>
      </CardTitle>
      <form onSubmit={add} className="grid gap-2" noValidate>
        <Label htmlFor="pa-note">New note</Label>
        <Textarea
          id="pa-note"
          rows={3}
          maxLength={4000}
          value={body}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "pa-note-err" : undefined}
          onChange={(e) => {
            setBody(e.target.value);
            if (error) setError("");
          }}
          placeholder="Strong Reels engagement; check audience country split before an offer."
        />
        {error && <p id="pa-note-err" className="text-[12.5px] text-destructive">{error}</p>}
        <div>
          <Button type="submit" variant="outline" disabled={busy}>{busy ? "Adding…" : "Add note"}</Button>
        </div>
      </form>
      {notes.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="mt-4 grid gap-2.5">
          {notes.map((n) => (
            <li key={n.id} className="rounded-2xl bg-secondary/40 p-3.5">
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed [overflow-wrap:anywhere]">{n.body}</p>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                {n.author} · <time dateTime={n.createdAt}>{fmtDate(n.createdAt, true)}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
