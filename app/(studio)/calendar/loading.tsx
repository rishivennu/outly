import { FunLoader } from "@/components/shared/FunLoader";

export default function Loading() {
  return <FunLoader label="Laying out your week" lines={["Flipping the calendar…", "Sorting the mail bag…", "We're doing great!", "Almost there, keep going!"]} />;
}
