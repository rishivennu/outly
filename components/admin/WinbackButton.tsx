"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";

/** One win-back email with an optional personal line. Disabled for 30 days after the last one. */
export function WinbackButton({ userId, name, email, lastSent }: { userId: string; name: string; email: string; lastSent: string | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const toast = useToast();
  const router = useRouter();
  const noteId = useId();
  const first = name.split(" ")[0];

  if (lastSent) {
    return <span className="text-[12px] text-muted-foreground">Emailed {lastSent}</span>;
  }

  async function go() {
    setBusy(true);
    try {
      const r = await adminApi<{ status: string }>("/api/admin/retention", { method: "POST", json: { userId, note: note.trim() || undefined } });
      toast(r.status === "mocked" ? `Win-back email for ${first} is in the Outbox (mock email).` : `Win-back email sent to ${first}.`, "ok");
      setOpen(false);
      setNote("");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[12.5px] font-semibold hairline transition-colors hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={`Send a win-back email to ${name}`}
      >
        <Send className="h-3.5 w-3.5" aria-hidden /> Win back
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => !busy && setOpen(o)}
        title={`Email ${first}?`}
        body={`A short "your studio misses you" email goes to ${email}. They can get one every 30 days at most, so this locks the button for a month.`}
        confirmLabel={busy ? "Sending" : "Send email"}
        cancelLabel="Not now"
        tone="primary"
        busy={busy}
        onConfirm={go}
        extra={
          <div className="mt-4 text-left">
            <label htmlFor={noteId} className="mb-1.5 block text-[13px] font-semibold">
              Personal line <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 600))}
              rows={3}
              placeholder={`e.g. Saw your last reel did well, ${first}. Want help planning the next one?`}
              className="w-full resize-none rounded-2xl bg-background px-3.5 py-2.5 text-[14px] hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            />
            <p className="mt-1 text-right text-[11.5px] text-muted-foreground tabular">{note.length}/600</p>
          </div>
        }
      />
    </>
  );
}
