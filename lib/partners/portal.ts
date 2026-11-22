import { db } from "@/lib/db";
import type { PortalData } from "@/components/partners/PortalView";
import { acceptedOfferByToken } from "@/lib/partners/offers";
import { attributionSummary, partnerLink } from "@/lib/partners/attribution";
import { listDeliverables, publicDeliverable } from "@/lib/partners/deliverables";
import type { OfferTerms } from "@/lib/partners/offer-core";
import { PARTNER_STATUS_LABEL, type PartnerStatus } from "@/lib/partners/types";

/** Everything the partner portal shows for an accepted offer's token; null when the link isn't active. */
export async function portalData(token: string): Promise<PortalData | null> {
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
