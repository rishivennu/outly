/** Client-safe offer helpers: the plain-language terms a creator reads, and the snapshot stored when they accept. */
import { formatMoney } from "../billing/money";
import { PARTNER_PLATFORM_LABEL, type PartnerOfferType, type PartnerPlatform } from "./types";

export const OFFER_CURRENCIES = ["INR", "USD", "EUR", "GBP"] as const;
export type OfferCurrency = (typeof OFFER_CURRENCIES)[number];

export const OFFER_TYPE_LABEL: Record<PartnerOfferType, string> = {
  paid: "Paid collaboration",
  subscription: "Complimentary subscription",
  custom: "Custom arrangement",
};

export const OFFER_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

export interface OfferTerms {
  type: string;
  typeLabel: string;
  amount: string; // formatted, "" when there is no payment
  amountMinor: number;
  currency: string;
  paymentTerms: string;
  planSlug: string;
  planName: string;
  subscriptionDays: number;
  startsAt: string | null;
  endsAt: string | null;
  deliverables: number;
  platforms: string[];
  platformLabels: string[];
  format: string;
  deadlines: string;
  disclosure: boolean;
  usageRights: string;
  conditions: string;
  termsVersion?: string;
  acceptedAt?: string;
}

type OfferLike = {
  type: string; amountMinor: number; currency: string; paymentTerms: string; planSlug: string; subscriptionDays: number;
  startsAt: Date | string | null; endsAt: Date | string | null; deliverables: number; platforms: string[]; format: string;
  deadlines: string; disclosure: boolean; usageRights: string; conditions: string;
};

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export function offerTermsOf(o: OfferLike, planName = ""): OfferTerms {
  return {
    type: o.type,
    typeLabel: OFFER_TYPE_LABEL[o.type as PartnerOfferType] ?? o.type,
    amount: o.amountMinor > 0 ? formatMoney(o.amountMinor, o.currency) : "",
    amountMinor: o.amountMinor,
    currency: o.currency,
    paymentTerms: o.paymentTerms,
    planSlug: o.planSlug,
    planName: o.planSlug ? planName || o.planSlug : "",
    subscriptionDays: o.planSlug ? o.subscriptionDays : 0,
    startsAt: iso(o.startsAt),
    endsAt: iso(o.endsAt),
    deliverables: o.deliverables,
    platforms: o.platforms,
    platformLabels: o.platforms.map((p) => PARTNER_PLATFORM_LABEL[p as PartnerPlatform] ?? p),
    format: o.format,
    deadlines: o.deadlines,
    disclosure: o.disclosure,
    usageRights: o.usageRights,
    conditions: o.conditions,
  };
}

/** "1 month" for 30 days, "2 months" for 60, otherwise the days. */
export function durationLabel(days: number) {
  if (days === 30) return "1 month";
  if (days === 60) return "2 months";
  if (days === 90) return "3 months";
  return days === 1 ? "1 day" : `${days} days`;
}

export const fmtDay = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(d)) : "";

export const DELIVERABLE_APPROVALS = ["none", "pending", "approved", "changes"] as const;
export const DELIVERABLE_APPROVAL_LABEL: Record<(typeof DELIVERABLE_APPROVALS)[number], string> = {
  none: "Not needed",
  pending: "Waiting for approval",
  approved: "Approved",
  changes: "Changes requested",
};
