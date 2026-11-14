import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";
import { WAITLIST_STEPS, waitlistPerks } from "@/lib/marketing/waitlist-copy";
import { Shell } from "./bits";
import { Reveal } from "./Reveal";

/**
 * Waitlist sign-up on the landing page (1137). While waitlist mode is on the whole landing page stays up, and this
 * section sits after the product story, just before the footer. Every "Join the waitlist" button on the page (nav,
 * hero, platforms tile, closing call, footer) scrolls here. Same form, checks and receipt as /waitlist: the API
 * upserts by email, so joining twice keeps the first place in line.
 */
export function WaitlistJoin({ beta, total }: { beta: boolean; total: number }) {
  return (
    <section id="join" aria-labelledby="join-title" className="wlj scroll-mt-24 pb-24 pt-4 sm:pb-32">
      <Shell>
        <Reveal fx="depth" y={40}>
          <div className="wlj-card">
            <div className="wlj-head">
              <p className="wl-eyebrow">
                <span className="wl-live" aria-hidden="true" /> {beta ? "Outlly beta · Early access" : "Outlly · Early access"}
              </p>
              <h2 id="join-title" className="wlj-title">
                Like what you see? <span className="wl-accent">Get in early.</span>
              </h2>
              <p className="wl-lede">
                Everything above is what you&apos;ll be using. We&apos;re letting creators in a few at a time, so leave your email and we&apos;ll send your invite when your spot comes up.
              </p>
            </div>
            <div className="wlj-form scroll-mt-24" data-join-form="">
              <WaitlistForm beta={beta} />
              {total >= 25 && <p className="mt-5 text-center text-[15px] font-semibold text-foreground/80">{total.toLocaleString("en")} creators have joined so far.</p>}
              <p className="mt-3 text-center text-[14px] text-[hsl(var(--ap-ink2))]">
                Already have an account?{" "}
                <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-foreground underline-offset-4 hover:underline">
                  Sign in<ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </p>
            </div>
            <div className="wlj-more">
              <h3 className="wl-kicker">Why join the waitlist?</h3>
              <ul className="wl-benefits">
                {waitlistPerks(beta).map((t) => (
                  <li key={t}>
                    <span className="wl-tick" aria-hidden="true">
                      <Check className="h-3 w-3" strokeWidth={3.2} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
              <ol className="wlj-steps" aria-label="How the waitlist works">
                {WAITLIST_STEPS.map(([t, b], i) => (
                  <li key={t}>
                    <span className="wl-no" aria-hidden="true">0{i + 1}</span>
                    <span>
                      <span className="block font-display text-base font-bold tracking-[-0.015em]">{t}</span>
                      <span className="mt-0.5 block text-[14px] leading-snug text-[hsl(var(--ap-ink2))]">{b}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Reveal>
      </Shell>
    </section>
  );
}
