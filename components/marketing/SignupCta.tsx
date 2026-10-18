"use client";
import Link from "next/link";
import { useWaitlist } from "./useWaitlist";
import { BounceText } from "./Split";

/** A "Start creating" link that becomes "Join the waitlist" while the waitlist is on. Its letters bounce on hover (MotionFx). */
/** `magnet`: the button leans toward the pointer (LandingFx). */
export function SignupCta({ className, label = "Start creating", children, magnet = false }: { className?: string; label?: string; children?: React.ReactNode; magnet?: boolean }) {
  const waitlist = useWaitlist();
  return (
    <Link href={waitlist ? "/waitlist" : "/signup"} className={className} data-bounce="" data-magnet={magnet ? "" : undefined}>
      <BounceText text={waitlist ? "Join the waitlist" : label} />
      {children}
    </Link>
  );
}
