import { hasCredentials, loadKeys } from "@/lib/social/registry";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthFormSkeleton } from "@/components/auth/AuthFormSkeleton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  await loadKeys();
  return (
    <Suspense fallback={<AuthFormSkeleton fields={2} />}>
      <AuthForm
        mode="login"
        google={hasCredentials("youtube")}
        title="Welcome back"
        subtitle={`Sign in to pick up where you left off. Your drafts and schedule are waiting.${process.env.NEXT_PUBLIC_DEMO_LOGIN === "true" ? " The demo account is filled in for you." : ""}`}
      />
    </Suspense>
  );
}
