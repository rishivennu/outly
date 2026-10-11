import { PageSkeleton } from "@/components/shared/Skeleton";

export default function Loading() {
  return <PageSkeleton title="Loading your calendar" cards={7} aspect="aspect-[3/4] md:min-h-[420px]" />;
}
