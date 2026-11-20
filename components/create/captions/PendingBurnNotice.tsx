"use client";
import { useSyncExternalStore } from "react";
import { Captions } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CaptionStore, Handlers } from "./run-store";

export const PENDING_BURN_LINE = "Your captioned video is ready. It finished on another step, so your post still uses the video without captions.";

export const pendingBurnActions = (store: CaptionStore, onBurned?: Handlers["onBurned"]) => ({
  use: () => store.takeBurn(onBurned),
  keep: () => store.dropBurn(),
});

export function PendingBurnBody({ onUse, onKeep, className }: { onUse: () => void; onKeep: () => void; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-wrap items-center gap-2 rounded-2xl bg-secondary/60 p-3 hairline", className)}>
      <p className="min-w-0 flex-1 basis-56 text-[13px] text-foreground">{PENDING_BURN_LINE}</p>
      <Button type="button" variant="primary" onClick={onUse}><Captions className="h-4 w-4" aria-hidden />Use captioned video</Button>
      <Button type="button" variant="ghost" onClick={onKeep}>Keep this video</Button>
    </div>
  );
}

/**
 * R1265: a burn that finished off the caption editor waits as pendingBurn. This offers the same choice wherever it
 * mounts (the editor, and Launch so the clean video is never published by accident). `onBurned` is the swap to run
 * when no editor is mounted; Publish stays enabled either way.
 */
export function PendingBurnNotice({ store, onBurned, className }: { store: CaptionStore; onBurned?: Handlers["onBurned"]; className?: string }) {
  const read = () => {
    const s = store.getState();
    return !!s.pendingBurn && !s.busy;
  };
  const waiting = useSyncExternalStore(store.subscribe, read, read);
  if (!waiting) return null;
  const a = pendingBurnActions(store, onBurned);
  return <PendingBurnBody onUse={a.use} onKeep={a.keep} className={className} />;
}
