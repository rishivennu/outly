import { FunLoader } from "@/components/shared/FunLoader";

export default function Loading() {
  return <FunLoader label="Fetching your posts" lines={["Sorting the mail bag…", "Polishing your posts…", "We're doing great!", "Almost there, keep going!"]} />;
}
