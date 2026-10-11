import { Skeleton } from "@/components/shared/Skeleton";

export default function Loading() {
  return (
    <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your connected accounts…</span>
      <Skeleton className="h-3 w-36 rounded-full" />
      <Skeleton className="mt-5 h-[clamp(2.6rem,6vw,4.6rem)] w-[min(620px,95%)] rounded-3xl" />
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[420px] rounded-[32px]" />
        ))}
      </div>
    </div>
  );
}
