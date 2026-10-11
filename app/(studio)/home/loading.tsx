import { Skeleton } from "@/components/shared/Skeleton";

export default function Loading() {
  return (
    <div className="px-5 pb-16 pt-10 sm:px-10 lg:pt-14" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Opening Outly…</span>
      <Skeleton className="mx-auto h-3 w-20 rounded-full" />
      <Skeleton className="mx-auto mt-6 h-[clamp(2.7rem,9.5vw,8rem)] w-[min(760px,95%)] rounded-[32px]" />
      <Skeleton className="mx-auto mt-6 h-5 w-[min(320px,80%)] rounded-full" />
      <Skeleton className="mx-auto mt-10 aspect-[16/10] w-full max-w-[760px] rounded-[48px]" />
    </div>
  );
}
