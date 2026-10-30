import { RouteSkeleton } from "@/components/shared/RouteSkeleton";

export default function Loading() {
  return <RouteSkeleton shape="settings" label="Opening your settings" lines={["Finding your preferences…", "Lining up the switches…", "Almost there, keep going!"]} />;
}
