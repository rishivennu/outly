"use client";
import Link from "next/link";
import { ChevronRight, LayoutDashboard } from "lucide-react";
import { useSignedIn } from "./useSignedIn";
import { SignupCta } from "./SignupCta";

/** Final CTA buttons: a black Apple pill to sign up (or join the waitlist) plus a log-in link; one dashboard button once signed in. */
export function FinalCtaButtons() {
  const signedIn = useSignedIn();
  if (signedIn)
    return (
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        <Link href="/home" className="ap-btn">
          <LayoutDashboard className="h-[18px] w-[18px]" aria-hidden="true" />
          Open your dashboard
        </Link>
      </div>
    );
  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
      <SignupCta className="ap-btn" />
      <Link href="/login" className="ap-link">
        Log in
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
