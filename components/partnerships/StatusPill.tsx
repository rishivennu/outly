import { cn } from "@/lib/utils";
import { statusLabel, statusTone } from "./model";

/** Partnership status as dot + word, never colour alone. */
export function StatusPill({ status, className }: { status: string; className?: string }) {
  const t = statusTone(status);
  return (
    <span data-status={status} className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium", t.text, className)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", t.dot)} aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}
