import { Skeleton } from "@/components/shared/Skeleton";

export default function Loading() {
  return (
    <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your analytics…</span>
      <Skeleton className="h-3 w-24 rounded-full" />
      <Skeleton className="mt-6 h-[clamp(2.4rem,6.4vw,5.6rem)] w-[min(900px,95%)] rounded-3xl" />
      <div className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-[24px]" />
        ))}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-[360px] rounded-[28px]" />
        <Skeleton className="h-[360px] rounded-[28px]" />
      </div>
    </div>
  );
}
