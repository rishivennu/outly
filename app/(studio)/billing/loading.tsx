import { RouteSkeleton } from "@/components/shared/RouteSkeleton";

export default function Loading() {
  return <RouteSkeleton shape="cards" label="Opening billing" lines={["Checking your plan…", "Counting the receipts…", "Almost there, keep going!"]} />;
}
