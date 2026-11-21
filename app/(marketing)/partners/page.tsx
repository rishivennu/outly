import type { Metadata } from "next";
import ApplyForm, { type ApplyMe } from "@/components/partners/ApplyForm";
import { PartnersBento } from "@/components/partners/Bento";
import { PartnersHero } from "@/components/partners/Hero";
import { PartnerSteps, PartnersContactBand, WhatWeLookFor, WhoCanPartner } from "@/components/partners/Sections";
import { Shell } from "@/components/marketing/bits";
import { getCurrentUser, realUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { isProven } from "@/lib/founding";

const TITLE = "Partner With Outlly | Creator & Influencer Partnerships";
const DESCRIPTION =
  "Partner with Outlly as a content creator or influencer. Apply for paid collaborations, complimentary subscriptions, and opportunities to grow with Outlly.";

export const metadata: Metadata = {
  // Absolute: the root template would otherwise append " · Outlly" to a title that already names it.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/partners" },
  openGraph: { type: "website", siteName: "Outlly", title: TITLE, description: DESCRIPTION, url: "/partners" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
};

const BENEFITS = ["Paid creator collaborations", "Complimentary Creator subscription", "Opportunities to grow with Outlly"];

/** The signed-in person (the real one inside a team workspace), so the form can skip what the account already knows. */
async function applicant(): Promise<ApplyMe> {
  const me = await getCurrentUser().catch(() => null);
  if (!me) return null;
  const u = await db.user.findUnique({ where: { id: realUserId(me) }, select: { name: true, email: true, emailVerifiedAt: true, emailVerifiedFor: true } }).catch(() => null);
  if (!u) return null;
  return { name: u.name, email: u.email, verified: isProven(u) };
}

export default async function PartnersPage() {
  const me = await applicant();
  return (
    <>
      <PartnersHero />
      {/* R1287: the sections below the hero are flat colour tiles with the "play" serif (components/partners/Bento.tsx, Sections.tsx). */}
      <PartnersBento />
      <WhoCanPartner />
      <WhatWeLookFor />
      <PartnerSteps />
      <section id="apply" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="partners-apply">
        <Shell>
          <p className="eyebrow mb-5">Apply</p>
          <h2 id="partners-apply" className="play text-[clamp(2rem,2.4vw+1rem,3rem)]">
            {"Let's get you rewarded."}
          </h2>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-muted-foreground sm:text-[17px]">
            {"Share a little about your content and audience. If we're a good fit, you could earn through paid collaborations or get access to Outlly Creator for free."}
          </p>
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="What you could get">
            {BENEFITS.map((b) => (
              <li key={b} className="inline-flex min-h-9 items-center gap-2 rounded-full bg-secondary/60 px-3.5 text-[14px] font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-lime-ink" aria-hidden="true" />
                {b}
              </li>
            ))}
          </ul>
          <div className="mt-10">
            <ApplyForm me={me} />
          </div>
        </Shell>
      </section>
      <PartnersContactBand />
    </>
  );
}
