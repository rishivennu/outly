"use client";
import Link from "next/link";
import { useWaitlist } from "../useWaitlist";
import { Arrow } from "./Art";

/** The one solid lime tile in Platforms: the whole tile is the sign-up (or waitlist) link. */
export function LimeCta({ title, sub }: { title: string; sub: string }) {
  const waitlist = useWaitlist();
  return (
    <Link href={waitlist ? "/waitlist" : "/signup"} className="bx-tile bx-lime">
      <Arrow />
      <span className="bx-copy mt-auto block pt-10">
        <span className="bx-big block">{waitlist ? "Join the waitlist" : title}</span>
        <span className="bx-sub block">{waitlist ? "We let people in every week. Your spot is saved." : sub}</span>
      </span>
    </Link>
  );
}
