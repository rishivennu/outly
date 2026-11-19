import { RouteSkeleton } from "@/components/shared/RouteSkeleton";

export default function Loading() {
  return <RouteSkeleton shape="analytics" label="Reading your published posts" lines={["Comparing like with like…", "Checking the sample sizes…", "Measuring, not guessing…", "Almost there, keep going!"]} frame="page-frame pb-20" />;
}
