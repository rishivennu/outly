import type { Metadata } from "next";
import ApplyForm from "@/components/partners/ApplyForm";
import { PartnersBento } from "@/components/partners/Bento";
import { PartnersHero } from "@/components/partners/Hero";
import { PartnerSteps, PartnersContactBand, WhatWeLookFor, WhoCanPartner } from "@/components/partners/Sections";
import { Shell } from "@/components/marketing/bits";

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

export default function PartnersPage() {
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
            Apply for partnership
          </h2>
          <div className="mt-10">
            <ApplyForm />
          </div>
        </Shell>
      </section>
      <PartnersContactBand />
    </>
  );
}
