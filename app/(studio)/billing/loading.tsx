import { RouteSkeleton } from "@/components/shared/RouteSkeleton";

export default function Loading() {
  return <RouteSkeleton shape="billing" label="Opening billing" lines={["Checking your plan…", "Counting the receipts…", "Almost there, keep going!"]} frame="px-5 pb-16 pt-8 sm:px-10 lg:pt-12" />;
}
