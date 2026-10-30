"use client";
import { useEffect } from "react";
import { Gift } from "lucide-react";

/**
 * Signup through a friend's link (1052): says who invited them (1066: the sharer, not the newcomer, earns the
 * month, so this makes no promise to the newcomer), and tells the server once
 * that the link was opened, so the sharer sees "Invited". The server reads only the cookies the middleware
 * set from ?ref=CODE, so this can't credit anyone on its own.
 */
export function ReferralInvite({ plan, days }: { plan: string; days: number }) {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("ol-ref-open")) return;
      sessionStorage.setItem("ol-ref-open", "1");
    } catch {
      /* private mode: report anyway, the server ignores repeats */
    }
    void fetch("/api/referral/open", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
  }, []);
  const length = days === 30 ? "a free month" : `${days} free days`;
  return (
    <div className="gs-in mb-5 flex items-start gap-3 rounded-2xl bg-card p-3 pr-4 hairline">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl lime-bg text-lime-ink" aria-hidden>
        <Gift className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug">A friend invited you to Outlly</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
          Sign up free and start planning your posts. When you pick a paid plan, your friend gets {length} of {plan} as a thank you.
        </p>
      </div>
    </div>
  );
}
