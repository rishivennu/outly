import { cn } from "@/lib/utils";

export type StorageMeterData = { usedBytes: number; limitBytes: number; pct: number; over: boolean; label: string };

/** Total storage across every device: "200 MB used, 300 MB remaining out of 500 MB". */
export function StorageMeter({ s, className, id = "storage-l" }: { s: StorageMeterData; className?: string; id?: string }) {
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span id={id}>Storage</span>
        <span className="tabular text-muted-foreground">{s.label}</span>
      </div>
      {s.limitBytes > 0 && (
        <div role="progressbar" aria-labelledby={id} aria-valuetext={s.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.pct)} className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
          <div className={cn("h-full rounded-full", s.over || s.pct >= 100 ? "bg-destructive" : s.pct >= 80 ? "bg-warning" : "bg-lime")} style={{ width: `${Math.max(s.usedBytes > 0 ? 1 : 0, s.pct)}%` }} />
        </div>
      )}
      {s.over && <p className="mt-1.5 text-xs text-foreground">You're over your storage, so new uploads are paused. Your files are safe; delete some or upgrade for more room.</p>}
    </div>
  );
}
