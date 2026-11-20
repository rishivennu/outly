import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Shell } from "@/components/marketing/bits";
import { PortalView, type PortalData } from "@/components/partners/PortalView";
import { acceptedOfferByToken } from "@/lib/partners/offers";
import { attributionSummary, partnerLink } from "@/lib/partners/attribution";
import { listDeliverables, publicDeliverable } from "@/lib/partners/deliverables";
import type { OfferTerms } from "@/lib/partners/offer-core";
import { PARTNER_STATUS_LABEL, type PartnerStatus } from "@/lib/partners/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Partner portal",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

async function load(token: string): Promise<PortalData | null> {
  const offer = await acceptedOfferByToken(token);
  if (!offer) return null;
  const [app, grant, items, counts] = await Promise.all([
    db.partnerApplication.findUnique({ where: { id: offer.applicationId }, select: { status: true, partnerCode: true, ref: true, fullName: true } }),
    offer.grantId ? db.planGrant.findUnique({ where: { id: offer.grantId }, include: { plan: { select: { name: true } } } }) : null,
    listDeliverables(offer.applicationId),
    attributionSummary(offer.applicationId),
  ]);
  if (!app) return null;
  const terms = offer.accepted ? (JSON.parse(offer.accepted) as OfferTerms) : null;
  return {
    firstName: app.fullName.trim().split(/\s+/)[0]?.slice(0, 40) ?? "",
    ref: app.ref,
    status: PARTNER_STATUS_LABEL[app.status as PartnerStatus] ?? app.status,
    link: app.partnerCode ? partnerLink(app.partnerCode) : null,
    benefit: grant
      ? { plan: grant.plan.name, state: grant.status, startsAt: grant.startsAt.toISOString(), endsAt: grant.endsAt.toISOString() }
      : terms && terms.subscriptionDays > 0 ? { plan: terms.planName, state: "not_granted", startsAt: null, endsAt: null } : null,
    deliverables: items.map(publicDeliverable),
    counts: { visits: counts.visits, signups: counts.signups },
  };
}

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await load(token);
  return (
    <section className="py-16 sm:py-24">
      <Shell className="max-w-[860px]">
        {data ? (
          <PortalView token={token} data={data} />
        ) : (
          <div className="max-w-xl">
            <h1 className="display text-balance text-[clamp(2rem,5vw,3rem)] leading-[1.1]">This portal link isn&apos;t active</h1>
            <p className="mt-4 text-pretty text-[17px] leading-relaxed text-muted-foreground">
              The portal opens once you accept an offer. Use the link from your acceptance email, or reply to it and we will help.
            </p>
            <Link href="/partners" className="mt-6 inline-flex min-h-11 items-center text-[15px] font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              About the Creator Partnership Program
            </Link>
          </div>
        )}
      </Shell>
    </section>
  );
}
