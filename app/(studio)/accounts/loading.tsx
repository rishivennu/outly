import { RouteSkeleton } from "@/components/shared/RouteSkeleton";

export default function Loading() {
  return <RouteSkeleton shape="cards" label="Checking your accounts" lines={["Saying hi to Instagram…", "Knocking on YouTube's door…", "We're doing great!", "Almost there, keep going!"]} />;
}
