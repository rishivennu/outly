import { FunLoader } from "@/components/shared/FunLoader";

export default function Loading() {
  return <FunLoader label="Collecting your comments" lines={["Reading every reply…", "Licking the stamp…", "We're doing great!", "Almost there, keep going!"]} />;
}
