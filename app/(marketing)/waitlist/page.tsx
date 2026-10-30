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
  const early = [
    "We let creators in a few at a time, in the order they joined.",
    beta ? "Free while Outlly is in beta. No card needed." : "Free to start. No card needed.",
    "One email when your invite is ready. Nothing else.",
  ];
  return (
    // No solid canvas here (1039): the brand sky behind every public page has to show through.
    <div className="wl-page">
      <section className="wl-stage" aria-labelledby="wl-title">
        <span className="wl-pix" aria-hidden="true" />
        <div className="wl-split wl-rise">
          <div className="wl-headcell">
            <p className="inline-flex items-center gap-2 rounded-full bg-lime/15 px-3 py-1 text-[13px] font-semibold text-[hsl(var(--lime-ink))] shadow-[inset_0_0_0_1px_hsl(var(--lime-ink)/.25)]">
              <span className="wl-live" aria-hidden="true" /> {beta ? "Outlly beta · early access" : "Outlly early access"}
            </p>
            <h1 id="wl-title" className="mt-4 text-balance font-display text-[clamp(2rem,4.6vw,3.25rem)] font-bold leading-[1.04] tracking-[-0.035em]">
              Create once. Post everywhere. Get your <span className="wl-accent">hours</span> back.
            </h1>
            <p className="mt-4 max-w-[34rem] text-pretty text-[16.5px] leading-relaxed text-[hsl(var(--ap-ink2))]">
              Outlly is an all-in-one content studio. Plan, create, schedule and publish to all your social accounts from one place, then see how every post did.
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
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--ap-ink2))]">What early access means</h2>
            <ul className="mt-3 grid gap-2">
              {early.map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-[15px] leading-snug text-foreground/85">
                  <span className="mt-[1px] inline-grid h-5 w-5 shrink-0 place-items-center rounded-full bg-lime/20 text-[hsl(var(--lime-ink))]" aria-hidden="true">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <WaitlistForm fromGoogle={searchParams.from === "google"} />
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
