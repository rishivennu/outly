import { hasCredentials, loadKeys } from "@/lib/social/registry";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";
import { OutlyLogo } from "@/components/brand/Logo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  await loadKeys();
  return (
    <>
      <OutlyLogo size={32} className="mb-8 text-xl lg:hidden" />
      <h1 className="display text-5xl">Welcome back.</h1>
      <p className="mb-8 mt-3 text-muted-foreground">Your videos missed you.{process.env.NEXT_PUBLIC_DEMO_LOGIN === "true" ? " The demo account is filled in for you." : ""}</p>
      <Suspense>
        <AuthForm mode="login" google={hasCredentials("youtube")} />
      </Suspense>
    </>
  );
}
