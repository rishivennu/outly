import { Skeleton } from "@/components/shared/Skeleton";

export default function Loading() {
  return (
    <div className="page-frame pb-20 pt-6 lg:pt-10" aria-busy="true" aria-label="Loading your partnerships">
      <Skeleton className="h-10 w-72 max-w-full rounded-2xl" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full rounded-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px] rounded-[24px]" />
        ))}
      </div>
      <div className="mt-6 grid gap-4">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-[196px] rounded-[24px]" />
        ))}
      </div>
    </div>
  );
}
