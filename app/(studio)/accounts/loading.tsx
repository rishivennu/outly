import { FunLoader } from "@/components/shared/FunLoader";

export default function Loading() {
  return <FunLoader label="Checking your accounts" lines={["Saying hi to Instagram…", "Knocking on YouTube's door…", "We're doing great!", "Almost there, keep going!"]} />;
}
