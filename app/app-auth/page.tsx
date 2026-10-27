import { Suspense } from "react";
import { AppAuthBridge } from "@/components/app/AppAuthBridge";

export const metadata = { title: "Continue", robots: { index: false } };

export default function AppAuthPage() {
  return (
    <Suspense>
      <AppAuthBridge />
    </Suspense>
  );
}
