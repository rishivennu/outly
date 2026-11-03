import { RouteSkeleton } from "@/components/shared/RouteSkeleton";

export default function Loading() {
  return <RouteSkeleton shape="platform" label="Counting your views" lines={["Adding up the likes…", "Licking the stamp…", "We're doing great!", "Almost there, keep going!"]} frame="page-frame pb-16" />;
}
