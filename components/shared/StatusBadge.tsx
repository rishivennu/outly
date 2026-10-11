import { cn } from "@/lib/utils";

/**
 * The real technical state, always spelled out. Friendly copy lives next to a
 * badge, never instead of it — so "You're live." never hides "failed".
 */
const MAP: Record<string, { label: string; dot: string; text: string }> = {
  draft: { label: "Draft", dot: "bg-muted-foreground", text: "text-muted-foreground" },
  queued: { label: "Queued", dot: "bg-cyan", text: "text-cyan" },
  pending: { label: "Queued", dot: "bg-cyan", text: "text-cyan" },
  uploading: { label: "Uploading", dot: "bg-cyan animate-pulse", text: "text-cyan" },
  processing: { label: "Processing", dot: "bg-accent animate-pulse", text: "text-accent" },
  publishing: { label: "Publishing", dot: "bg-accent animate-pulse", text: "text-accent" },
  scheduled: { label: "Scheduled", dot: "bg-warning", text: "text-warning" },
  published: { label: "Published", dot: "bg-success", text: "text-success" },
  partial: { label: "Partly published", dot: "bg-warning", text: "text-warning" },
  failed: { label: "Failed", dot: "bg-destructive", text: "text-destructive" },
  needs_reconnect: { label: "Needs reconnection", dot: "bg-warning", text: "text-warning" },
  disconnected: { label: "Disconnected", dot: "bg-muted-foreground", text: "text-muted-foreground" },
  connected: { label: "Connected", dot: "bg-success", text: "text-success" },
};

/** Status is always dot + word, never colour alone. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = MAP[status] ?? { label: status, dot: "bg-muted-foreground", text: "text-muted-foreground" };
  return (
    <span className={cn("glass-strong inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", s.text, className)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} aria-hidden="true" />
      {s.label}
    </span>
  );
}
