import { RouteSkeleton } from "@/components/shared/RouteSkeleton";

export default function Loading() {
  return <RouteSkeleton shape="grid" label="Fetching your posts" lines={["Sorting the mail bag…", "Polishing your posts…", "We're doing great!", "Almost there, keep going!"]} />;
}
