import { RouteSkeleton } from "@/components/shared/RouteSkeleton";

export default function Loading() {
  return <RouteSkeleton shape="analytics" label="Counting your views" lines={["Adding up the likes…", "Licking the stamp…", "We're doing great!", "Almost there, keep going!"]} frame="mx-auto w-full max-w-[1320px] px-5 pb-20 sm:px-10" />;
}
