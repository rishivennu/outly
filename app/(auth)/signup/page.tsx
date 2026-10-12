import { hasCredentials, loadKeys } from "@/lib/social/registry";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";
import { OutlyLogo } from "@/components/brand/Logo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create your account" };

export default async function SignupPage() {
  await loadKeys();
  return (
    <>
      <OutlyLogo size={32} className="mb-8 text-xl lg:hidden" />
      <h1 className="display text-5xl">Let&apos;s get you set up.</h1>
      <p className="mb-8 mt-3 text-muted-foreground">Takes ten seconds. Then bring a video.</p>
      <Suspense>
        <AuthForm mode="signup" google={hasCredentials("youtube")} />
      </Suspense>
    </>
  );
}
