import { PageSkeleton } from "@/components/shared/Skeleton";

export default function Loading() {
  return <PageSkeleton title="Gathering your comments" cards={6} />;
}
