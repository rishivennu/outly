"use client";
import Link from "next/link";
import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { autosaveLine, type SaveState } from "./publish";
import { DRAFT_TTL_DAYS } from "@/lib/client/device-drafts";

interface Props {
  state: SaveState;
  /** Formatted clock time of the last successful save, or null when nothing is saved yet. */
  at: string | null;
  onSave: () => void;
  busy: boolean;
}

/** Explicit saving, on every step once a video exists, with the autosave line always on screen. */
export function SaveDraft({ state, at, onSave, busy }: Props) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button variant="subtle" onClick={onSave} disabled={busy}>
        <Save className="h-4 w-4" /> {busy ? "Saving" : "Save draft"}
      </Button>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {autosaveLine(state, at)}
      </p>
      {state === "error" && (
        <Button variant="ghost" size="sm" onClick={onSave}>
          <RotateCcw className="h-4 w-4" /> Retry
        </Button>
      )}
      {at && (
        <Link href="/content?filter=draft" className="inline-flex min-h-[44px] items-center text-xs font-semibold underline underline-offset-4">
          View drafts
        </Link>
      )}
      <p className="w-full text-xs text-muted-foreground">A copy stays in this browser too. Drafts you don&apos;t touch for {DRAFT_TTL_DAYS} days are removed from Outlly.</p>
    </div>
  );
}
