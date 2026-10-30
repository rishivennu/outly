import { RouteSkeleton } from "@/components/shared/RouteSkeleton";

export default function Loading() {
  return <RouteSkeleton shape="list" label="Collecting your comments" lines={["Reading every reply…", "Licking the stamp…", "We're doing great!", "Almost there, keep going!"]} />;
}
