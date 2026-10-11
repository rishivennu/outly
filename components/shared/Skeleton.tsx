import { cn } from "@/lib/utils";

/** Shimmer placeholder. Always inside an aria-busy region so it is not announced. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-2xl", className)} aria-hidden="true" />;
}

/** Page-level placeholder used by route-level loading.tsx files. */
export function PageSkeleton({ title = "Loading", cards = 8, aspect = "aspect-[9/16]" }: { title?: string; cards?: number; aspect?: string }) {
  return (
    <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{title}…</span>
      <Skeleton className="h-3 w-24 rounded-full" />
      <Skeleton className="mt-4 h-[clamp(2.6rem,6vw,4.6rem)] w-[min(680px,90%)] rounded-3xl" />
      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className={cn(aspect, "rounded-[24px]")} />
        ))}
      </div>
    </div>
  );
}
