import { hasCredentials, loadKeys } from "@/lib/social/registry";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthFormSkeleton } from "@/components/auth/AuthFormSkeleton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create your account" };

export default async function SignupPage() {
  await loadKeys();
  return (
    <Suspense fallback={<AuthFormSkeleton fields={3} />}>
      <AuthForm mode="signup" google={hasCredentials("youtube")} title="Create an account" subtitle="Upload once, post everywhere. Takes ten seconds." />
    </Suspense>
  );
}
