import { FunLoader } from "@/components/shared/FunLoader";

export default function Loading() {
  return <FunLoader label="Counting your views" lines={["Adding up the likes…", "Licking the stamp…", "We're doing great!", "Almost there, keep going!"]} />;
}
