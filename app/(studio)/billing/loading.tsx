import { FunLoader } from "@/components/shared/FunLoader";

export default function Loading() {
  return <FunLoader label="Opening billing" lines={["Checking your plan…", "Counting the receipts…", "Almost there, keep going!"]} />;
}
