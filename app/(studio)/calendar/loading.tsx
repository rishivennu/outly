import { RouteSkeleton } from "@/components/shared/RouteSkeleton";

export default function Loading() {
  return <RouteSkeleton shape="calendar" label="Laying out your week" lines={["Flipping the calendar…", "Sorting the mail bag…", "We're doing great!", "Almost there, keep going!"]} />;
}
