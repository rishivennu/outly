import { FunLoader } from "@/components/shared/FunLoader";

export default function Loading() {
  return <FunLoader label="Opening your settings" lines={["Finding your preferences…", "Lining up the switches…", "Almost there, keep going!"]} />;
}
