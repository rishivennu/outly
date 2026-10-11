import { cn } from "@/lib/utils";

/** Marks anything attached to a practice (rehearsal) account: it never posts for real. */
export function PracticePill({ className }: { className?: string }) {
  return (
    <span
      title="Practice account — nothing is posted for real."
      className={cn("inline-flex shrink-0 items-center rounded-full bg-secondary/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hairline", className)}
    >
      Practice
    </span>
  );
}
