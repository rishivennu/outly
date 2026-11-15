"use client";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/shared/Sheet";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { diffDrafts, type LocalDraft, type ServerDraft } from "@/lib/client/draft-sync-core";

interface Props {
  open: boolean;
  /** What this device has (the editor's current words). */
  local: LocalDraft;
  /** The newer copy another device saved (the 409 draft_conflict body's `server`). */
  server: ServerDraft | null;
  onKeepLocal: () => void;
  onKeepServer: () => void;
  /** Closing chooses nothing: both copies stay as they are until the user picks one. */
  onClose: () => void;
  busy?: boolean;
}

const name = (p: string) => PLATFORM_META[p as Platform]?.name ?? p;
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

function Version({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-secondary p-3 hairline">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{value.trim() ? value : <span className="text-muted-foreground">Empty</span>}</p>
    </div>
  );
}

/** Both versions of a draft that changed on two devices, field by field. Nothing is overwritten until a choice is made. */
export function ConflictDialog({ open, local, server, onKeepLocal, onKeepServer, onClose, busy }: Props) {
  const diffs = server ? diffDrafts(local, server, name) : [];
  const at = server ? when(server.updatedAt) : null;
  return (
    <Sheet
      open={open && !!server}
      onOpenChange={(o) => !o && !busy && onClose()}
      side="center"
      title="This draft changed on another device"
      description={at ? `The other copy was saved ${at}. Pick the one to keep. Nothing changes until you choose.` : "Pick the one to keep. Nothing changes until you choose."}
    >
      {diffs.length ? (
        <ul className="space-y-4" aria-label="What is different">
          {diffs.map((d) => (
            <li key={d.key}>
              <p className="text-sm font-semibold">{d.label}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Version label="This device" value={d.mine} />
                <Version label="Other device" value={d.theirs} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">The words match. Only the save times differ, so either choice keeps the same draft.</p>
      )}
      <div className="sticky bottom-0 mt-6 flex flex-wrap-reverse gap-2 bg-gradient-to-t from-background/80 pt-3">
        <Button variant="subtle" className="min-h-11 min-w-[10rem] flex-1" onClick={onKeepServer} disabled={busy}>
          Keep the other device&apos;s
        </Button>
        <Button variant="primary" className="min-h-11 min-w-[10rem] flex-1" onClick={onKeepLocal} disabled={busy}>
          Keep mine
        </Button>
      </div>
    </Sheet>
  );
}
