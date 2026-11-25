"use client";
import { useId } from "react";
import { Sparkles } from "lucide-react";
import { SharingRow } from "@/components/intelligence/SharingRow";
import { CONSENT_TITLE } from "@/lib/intelligence/consent-core";

/**
 * R1335: the "Help improve Outlly AI" consent, where the spec puts it: Settings > Data & Privacy. Optional, off until
 * the creator turns it on, independent of the plan (it never unlocks Personal Intelligence, and declining changes
 * nothing else about the account). The row itself is shared with the Intelligence page.
 */
export function AiConsentCard() {
  const id = useId();
  return (
    <section id="ai-consent" className="glass scroll-mt-24 rounded-[32px] p-6 sm:p-8" aria-labelledby={`${id}-h`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary" aria-hidden>
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h2 id={`${id}-h`} className="text-2xl font-semibold tracking-tight">{CONSENT_TITLE}</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Optional. Off until you turn it on, and your account works the same either way. It does not switch on Personal Intelligence; that comes with the Creator and Agency plans.
          </p>
        </div>
      </div>
      <SharingRow source="settings" />
    </section>
  );
}
