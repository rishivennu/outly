import { RouteSkeleton } from "@/components/shared/RouteSkeleton";

export default function Loading() {
  return <RouteSkeleton shape="billing" label="Opening billing" lines={["Checking your plan…", "Counting the receipts…", "Almost there, keep going!"]} frame="page-frame pb-16 pt-8 lg:pt-12" />;
}
