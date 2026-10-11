import { PageSkeleton } from "@/components/shared/Skeleton";

export default function Loading() {
  return <PageSkeleton title="Loading your content" cards={10} />;
}
