import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BarChart3, CalendarClock, Check, ChevronRight, LayoutDashboard, Send } from "lucide-react";
import { OutlyLogo } from "@/components/brand/Logo";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";
import { GlobeStage } from "@/components/waitlist/globe/GlobeStage";
import { siteStatus, waitlistCounts } from "@/lib/site";
import { isBeta } from "@/lib/beta";

export const metadata: Metadata = {
  title: "Join the waitlist",
  description: "Outlly is one place to plan, create, schedule and publish your posts to every platform. We're letting creators in a few at a time. Leave your email and we'll send your invite.",
};
export const dynamic = "force-dynamic";

/** What Outlly does, in four lines (1061). Kept to what the product does today. */
const OFFER = [
  { icon: LayoutDashboard, t: "Every account, one dashboard", b: "Your channels side by side, in one place." },
  { icon: CalendarClock, t: "Plan and schedule ahead", b: "Line posts up on a calendar, or send now." },
  { icon: Send, t: "Publish everywhere at once", b: "One upload, sized and captioned per platform." },
  { icon: BarChart3, t: "See what's working", b: "How each post did, without opening five apps." },
] as const;

/**
 * Waitlist (1061): one large card on a dotted stage, like the reference. Left: the brand-green world panel with
 * the globe and what Outlly does. Right: the headline and the sign-up. On phones it stacks headline, globe, form;
 * the nav keeps its "Join the waitlist" button pinned, so the CTA is always in reach.
 * DOM order is headline, panel, form (the grid places them), so screen readers meet the h1 first.
 */
export default async function WaitlistPage({ searchParams }: { searchParams: { from?: string } }) {
  const s = await siteStatus();
  if (!s.waitlist) redirect("/signup");
  const counts = await waitlistCounts();
  const beta = await isBeta();
  // 1062 copy. "Free throughout the beta" is only said while the site really is in beta (Admin > Beta).
  const early = [
    "Early access, offered in the order people join.",
    beta ? "Free to use throughout the beta. No credit card required." : "Free plan to start. No credit card required.",
    "One email when your invitation is ready. No unnecessary emails.",
  ];
  return (
    // No solid canvas here (1039): the brand sky behind every public page has to show through.
    <div className="wl-page">
      <section className="wl-stage" aria-labelledby="wl-title">
        <span className="wl-pix" aria-hidden="true" />
        <div className="wl-split wl-rise">
          <div className="wl-headcell">
            <p className="wl-eyebrow">
              <span className="wl-live" aria-hidden="true" /> {beta ? "Outlly beta · Early access" : "Outlly · Early access"}
            </p>
            <h1 id="wl-title" className="wl-title">
              <span className="wl-title-l">Create once.</span> <span className="wl-title-l">Publish everywhere.</span>{" "}
              <span className="wl-title-l">
                Get your <span className="wl-accent">time</span> back.
              </span>
            </h1>
            <p className="wl-lede">
              Outlly is your all-in-one content studio. Plan, create, schedule, and publish across your social platforms from one place. Track performance and spend less time managing content.
            </p>
          </div>

          <div className="wl-world" data-globe-host>
            <div className="wl-world-top">
              {/* phones already show the logo in the nav right above, so the panel only repeats it on the split layout */}
              <OutlyLogo size={26} tone="light" className="hidden text-[19px] text-white lg:inline-flex" />
              <span className="wl-chip ml-auto">{beta ? "Beta" : "Early access"}</span>
            </div>
            <GlobeStage />
            <div className="wl-offer">
              <h2 className="sr-only">What Outlly does</h2>
              <p className="wl-offer-lead">One place to plan, create, schedule and publish your content, on every platform you post to.</p>
              <ul className="wl-offer-grid">
                {OFFER.map(({ icon: I, t, b }) => (
                  <li key={t} className="flex gap-3">
                    <span className="wl-offer-ic" aria-hidden="true">
                      <I className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14.5px] font-semibold leading-snug text-white">{t}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-white/75">{b}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div id="join" className="wl-formcell scroll-mt-24">
            <h2 className="wl-kicker">Why join the waitlist?</h2>
            <ul className="wl-benefits">
              {early.map((t) => (
                <li key={t}>
                  <span className="wl-tick" aria-hidden="true">
                    <Check className="h-3 w-3" strokeWidth={3.2} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <WaitlistForm fromGoogle={searchParams.from === "google"} beta={beta} />
            </div>
            {counts.total >= 25 && (
              <p className="mt-5 text-center text-[14.5px] font-semibold text-foreground/80">{counts.total.toLocaleString("en")} creators have joined so far.</p>
            )}
            <p className="mt-3 text-center text-[14px] text-[hsl(var(--ap-ink2))]">
              Already have an account?{" "}
              <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-foreground underline-offset-4 hover:underline">
                Log in<ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </p>
          </div>
        </div>

        <ol className="wl-how" aria-label="How the waitlist works">
          {[
            ["Join", "Leave your email. It takes five seconds."],
            ["Get your invite", "We let people in by the order they joined."],
            ["Start posting", "Sign up with that email and bring a video."],
          ].map(([t, b], i) => (
            <li key={t}>
              <span className="wl-no" aria-hidden="true">0{i + 1}</span>
              <span>
                <span className="block font-display text-[16px] font-bold tracking-[-0.015em]">{t}</span>
                <span className="mt-0.5 block text-[14px] leading-snug text-[hsl(var(--ap-ink2))]">{b}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
