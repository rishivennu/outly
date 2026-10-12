"use client";
import Link from "next/link";
import { useWaitlist } from "./useWaitlist";

/** A "Start creating" link that becomes "Join the waitlist" while the waitlist is on. */
export function SignupCta({ className, label = "Start creating", children }: { className?: string; label?: string; children?: React.ReactNode }) {
  const waitlist = useWaitlist();
  return (
    <Link href={waitlist ? "/waitlist" : "/signup"} className={className}>
      {waitlist ? "Join the waitlist" : label}
      {children}
    </Link>
  );
}
