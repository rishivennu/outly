import type { PartnerStatus } from "./types";
export type MineSocial = { platform: string; handle: string; url: string; followers: number; primary: boolean };
export type MineOffer = {
  id: string; status: "sent" | "accepted" | "declined" | "withdrawn" | "expired"; version: number; // version = 1-based index among this application's offers by createdAt
  type: "paid" | "subscription" | "custom"; typeLabel: string; amountMinor: number; currency: string; amountLabel: string; paymentTerms: string;
  planSlug: string; planName: string; subscriptionDays: number; durationLabel: string; startsAt: string | null; endsAt: string | null;
  deliverables: number; platforms: string[]; format: string; deadlines: string; disclosure: boolean; usageRights: string; conditions: string;
  expiresAt: string | null; sentAt: string | null; respondedAt: string | null; decision: string; declineReason: string;
};
export type MineDeliverable = { id: string; title: string; platform: string; format: string; dueAt: string | null; publishedAt: string | null; url: string; status: "planned" | "submitted" | "published" | "verified" | "missed"; approval: string; creatorNote: string };
export type MineBenefit = { planName: string; status: string; startsAt: string; endsAt: string; daysLeft: number } | null;
export type MineEvent = { at: string; action: string; from: string | null; to: string | null; message: string }; // creator-safe only (admin notes and role stripped)
export type MineInfoRequest = { requestedAt: string; message: string; respondedAt: string | null } | null; // the open "more information" ask
export type MineApplication = {
  id: string; ref: string; status: PartnerStatus; statusLabel: string; form: "short" | "long";
  createdAt: string; updatedAt: string; lastStatusAt: string; reviewedAt: string | null; decidedAt: string | null;
  fullName: string; email: string; country: string;
  primaryPlatform: string; primaryHandle: string; followers: number; avgViews: number; engagementRate: number | null; niche: string; preference: string;
  socials: MineSocial[]; stats: Record<string, unknown>; proposal: Record<string, unknown>;
  decisionMessage: string; // customer-facing explanation for rejected/withdrawn, else ""
  infoRequest: MineInfoRequest;
  offer: MineOffer | null; // the offer awaiting a response (status "sent"), else the accepted one, else null
  offers: MineOffer[]; deliverables: MineDeliverable[]; benefit: MineBenefit; partnerCode: string | null; events: MineEvent[];
  nextAction: { kind: "none" | "respond_info" | "review_offer" | "submit_deliverables" | "withdraw"; label: string } ;
};
export type MineSummary = { submitted: number; underReview: number; offers: number; active: number };
