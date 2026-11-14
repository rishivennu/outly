"use client";
import { useEffect } from "react";
import { whenAnalyticsReady } from "@/lib/analytics/track";

/** 1149: ties analytics to the signed-in person by id only (plus plan and signup date). No email, name or phone. */
export function PostHogIdentify({ id, joinedAt }: { id: string; joinedAt: string }) {
  useEffect(
    () =>
      whenAnalyticsReady((ph) => {
        if (ph.get_distinct_id() !== id) ph.identify(id, undefined, { signup_date: joinedAt.slice(0, 10) });
        const memo = `outly-ph-plan:${id}`;
        try {
          if (sessionStorage.getItem(memo)) return;
        } catch {
          /* storage blocked: ask once per page load instead */
        }
        void fetch("/api/billing/usage", { credentials: "same-origin" })
          .then((r) => (r.ok ? r.json() : null))
          .then((u: { plan?: { slug?: string } } | null) => {
            const plan = u?.plan?.slug;
            if (!plan) return;
            ph.setPersonProperties({ plan });
            try {
              sessionStorage.setItem(memo, plan);
            } catch {
              /* fine */
            }
          })
          .catch(() => {});
      }),
    [id, joinedAt],
  );
  return null;
}
