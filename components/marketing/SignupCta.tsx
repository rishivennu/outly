"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { joinHref, useWaitlist } from "./useWaitlist";
import { BounceText } from "./Split";

/** A "Start creating" link that becomes "Join the waitlist" while the waitlist is on. Its letters bounce on hover (MotionFx). */
/** `magnet`: the button leans toward the pointer (LandingFx). `next`: where sign-up lands (AuthForm checks it with sameSitePath). */
export function SignupCta({ className, label = "Start creating", children, magnet = false, next }: { className?: string; label?: string; children?: React.ReactNode; magnet?: boolean; next?: string }) {
  const waitlist = useWaitlist();
  const pathname = usePathname();
  return (
    <Link href={waitlist ? joinHref(pathname) : next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className={className} data-bounce="" data-magnet={magnet ? "" : undefined}>
      <BounceText text={waitlist ? "Join the waitlist" : label} />
      {children}
    </Link>
  );
}
