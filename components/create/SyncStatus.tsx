"use client";
import { AlertTriangle, Check, CloudOff, GitCompareArrows, Loader2, RotateCcw, UploadCloud, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SYNC_LABEL, type SyncStatus as Status } from "@/lib/client/draft-sync-core";

const LOOK: Record<Status, { Icon: typeof Wifi; tone: string; spin?: boolean }> = {
  online: { Icon: Wifi, tone: "text-muted-foreground" },
  offline: { Icon: CloudOff, tone: "text-foreground" },
  saving: { Icon: Loader2, tone: "text-foreground", spin: true },
  waiting: { Icon: UploadCloud, tone: "text-foreground" },
  synced: { Icon: Check, tone: "text-success-ink" },
  failed: { Icon: AlertTriangle, tone: "text-destructive" },
  conflict: { Icon: GitCompareArrows, tone: "text-warning-ink" },
};

interface Props {
  status: Status;
  lastSyncedAt: number | null;
  error?: string | null;
  /** The change can't go up until the video has uploaded. */
  needsMedia?: boolean;
  /** Whether the last local write really reached this browser's storage; null = not known. */
  storedHere?: boolean | null;
  onRetry?: () => void;
  /** Opens the compare dialog while there is a conflict. */
  onResolve?: () => void;
  className?: string;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The second half of the pill. "Saved on this device" only when the browser really stored it. */
export function syncDetail(o: { status: Status; lastSyncedAt: number | null; error?: string | null; needsMedia?: boolean; storedHere?: boolean | null }, at: (ms: number) => string = clock): string | null {
  if (o.status === "synced") return o.lastSyncedAt ? `at ${at(o.lastSyncedAt)}` : null;
  if (o.status === "failed") return o.error || null;
  if (o.status !== "offline" && o.status !== "waiting") return null;
  if (o.status === "waiting" && o.needsMedia) return "Syncs after the video uploads";
  if (o.storedHere === true) return "Saved on this device";
  if (o.storedHere === false) return "Not saved on this device";
  return null;
}

/** Where this draft stands between this device and Outlly, always in words, never colour alone. */
export function SyncStatus({ status, lastSyncedAt, error, needsMedia, storedHere, onRetry, onResolve, className }: Props) {
  const { Icon, tone, spin } = LOOK[status];
  const detail = syncDetail({ status, lastSyncedAt, error, needsMedia, storedHere });
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <p role="status" aria-live="polite" className={cn("inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium hairline", tone)}>
        <Icon className={cn("h-3.5 w-3.5 shrink-0", spin && "motion-safe:animate-spin")} aria-hidden="true" />
        <span className="shrink-0">{SYNC_LABEL[status]}</span>
        {detail && <span className="min-w-0 truncate font-normal tabular-nums text-muted-foreground">{detail}</span>}
      </p>
      {status === "failed" && onRetry && (
        <Button variant="ghost" size="sm" className="min-h-11" onClick={onRetry}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry sync
        </Button>
      )}
      {status === "conflict" && onResolve && (
        <Button variant="ghost" size="sm" className="min-h-11" onClick={onResolve}>
          <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" /> Compare versions
        </Button>
      )}
    </div>
  );
}
