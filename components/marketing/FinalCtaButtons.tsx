"use client";
import Link from "next/link";
import { ArrowRight, ChevronRight, LayoutDashboard } from "lucide-react";
import { useSignedIn } from "./useSignedIn";
import { SignupCta } from "./SignupCta";

/** Final CTA buttons: the same lime pill as the hero to sign up (or join the waitlist) plus a log-in link; one dashboard button once signed in. */
export function FinalCtaButtons() {
  const signedIn = useSignedIn();
  if (signedIn)
    return (
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        <Link href="/home" className="ap-btn" data-magnet="">
          <LayoutDashboard className="h-[18px] w-[18px]" aria-hidden="true" />
          Open your dashboard
        </Link>
      </div>
    );
  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
      <SignupCta
        magnet
        className="lime-glow group inline-flex h-14 items-center justify-center gap-2 rounded-full bg-lime px-7 text-base font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
      >
        <ArrowRight className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
      </SignupCta>
      <Link href="/login" className="ap-link">
        Log in
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
