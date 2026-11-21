/**
 * R1282 Creator Partnership Program: the shared contract between the public /partners page, the application API,
 * the creator offer / portal pages and the admin "Creator Partnerships" area. Everything here is safe to import
 * from client components (no server-only imports).
 */

export const PARTNER_STATUSES = [
  "submitted",
  "under_review",
  "more_info",
  "approved",
  "rejected",
  "offer_sent",
  "offer_accepted",
  "active",
  "completed",
  "withdrawn",
] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

/** Labels shown to admins and to the creator (the creator never sees internal notes, only the status). */
export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = {
  submitted: "Submitted",
  under_review: "Under Review",
  more_info: "More Information Required",
  approved: "Approved",
  rejected: "Rejected",
  offer_sent: "Offer Sent",
  offer_accepted: "Offer Accepted",
  active: "Active Partnership",
  completed: "Completed",
  withdrawn: "Withdrawn",
};

/** StatusBadge tone per status (components/admin/ui.tsx tones: neutral | info | success | warning | danger). */
export const PARTNER_STATUS_TONE: Record<PartnerStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  submitted: "info",
  under_review: "info",
  more_info: "warning",
  approved: "success",
  rejected: "danger",
  offer_sent: "info",
  offer_accepted: "success",
  active: "success",
  completed: "neutral",
  withdrawn: "neutral",
};

/**
 * Allowed admin transitions. The creator can only move an application to `withdrawn` (any open status) and, through an
 * offer link, from `offer_sent` to `offer_accepted` (accept) or back to `approved` (decline, so a new offer can go out).
 * The system moves `offer_accepted` to `active` once the benefit or the first deliverable is set up.
 */
export const PARTNER_TRANSITIONS: Record<PartnerStatus, PartnerStatus[]> = {
  submitted: ["under_review", "more_info", "approved", "rejected", "withdrawn"],
  under_review: ["more_info", "approved", "rejected", "withdrawn"],
  more_info: ["under_review", "approved", "rejected", "withdrawn"],
  approved: ["offer_sent", "rejected", "under_review", "withdrawn"],
  rejected: ["under_review"],
  offer_sent: ["offer_accepted", "approved", "rejected", "withdrawn"],
  offer_accepted: ["active", "withdrawn"],
  active: ["completed", "withdrawn"],
  completed: [],
  withdrawn: ["under_review"],
};

export const canTransition = (from: string, to: string) =>
  (PARTNER_TRANSITIONS as Record<string, string[]>)[from]?.includes(to) ?? false;

/** Statuses that still count as "open" for duplicate detection and KPIs. */
export const OPEN_STATUSES: PartnerStatus[] = ["submitted", "under_review", "more_info", "approved", "offer_sent", "offer_accepted", "active"];

export const PARTNER_PLATFORMS = ["instagram", "youtube", "tiktok", "x", "linkedin", "facebook", "threads", "other"] as const;
export type PartnerPlatform = (typeof PARTNER_PLATFORMS)[number];
export const PARTNER_PLATFORM_LABEL: Record<PartnerPlatform, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  threads: "Threads",
  other: "Other",
};

export const PARTNER_FORMATS = ["reels", "shorts", "long_video", "stories", "posts", "carousels", "live", "newsletter", "other"] as const;
export type PartnerFormat = (typeof PARTNER_FORMATS)[number];
export const PARTNER_FORMAT_LABEL: Record<PartnerFormat, string> = {
  reels: "Reels",
  shorts: "Shorts",
  long_video: "Long videos",
  stories: "Stories",
  posts: "Posts",
  carousels: "Carousels",
  live: "Live streams",
  newsletter: "Newsletter",
  other: "Other",
};

export const PARTNER_NICHES = [
  "tech",
  "ai_tools",
  "productivity",
  "business",
  "marketing",
  "creator_economy",
  "finance",
  "education",
  "lifestyle",
  "entertainment",
  "gaming",
  "food",
  "travel",
  "other",
] as const;
export type PartnerNiche = (typeof PARTNER_NICHES)[number];
export const PARTNER_NICHE_LABEL: Record<PartnerNiche, string> = {
  tech: "Tech",
  ai_tools: "AI tools",
  productivity: "Productivity",
  business: "Business",
  marketing: "Marketing",
  creator_economy: "Creator economy",
  finance: "Finance",
  education: "Education",
  lifestyle: "Lifestyle",
  entertainment: "Entertainment",
  gaming: "Gaming",
  food: "Food",
  travel: "Travel",
  other: "Other",
};

export const PARTNER_PREFERENCES = ["paid", "subscription", "either", "custom"] as const;
export type PartnerPreference = (typeof PARTNER_PREFERENCES)[number];
export const PARTNER_PREFERENCE_LABEL: Record<PartnerPreference, string> = {
  paid: "Paid collaboration",
  subscription: "Complimentary Creator subscription",
  either: "Open to either",
  custom: "Custom arrangement",
};

export const POSTING_FREQUENCIES = ["daily", "several_week", "weekly", "few_month", "monthly"] as const;
export type PostingFrequency = (typeof POSTING_FREQUENCIES)[number];
export const POSTING_FREQUENCY_LABEL: Record<PostingFrequency, string> = {
  daily: "Daily",
  several_week: "Several times a week",
  weekly: "Weekly",
  few_month: "A few times a month",
  monthly: "Monthly or less",
};

export const AGE_RANGES = ["13-17", "18-24", "25-34", "35-44", "45-54", "55+", "mixed"] as const;

/** Indicative tiers from the brief. They describe the creator, they never decide the outcome. */
export const PARTNER_TIERS = ["emerging", "growing", "established"] as const;
export type PartnerTier = (typeof PARTNER_TIERS)[number];
export const PARTNER_TIER_LABEL: Record<PartnerTier, string> = { emerging: "Emerging", growing: "Growing", established: "Established" };
export function tierFor(followers: number): PartnerTier {
  if (followers >= 10_000) return "established";
  if (followers >= 5_000) return "growing";
  return "emerging";
}

/** JSON shapes stored on PartnerApplication (socials / stats / proposal columns). */
export interface PartnerSocial {
  platform: PartnerPlatform;
  handle: string; // without the @
  url: string;
  followers: number;
  niche?: PartnerNiche; // long form only; the short form asks for one category in stats
  format?: PartnerFormat;
  primary?: boolean;
}

export interface PartnerStats {
  avgViews: number;
  // R1289: the short form asks for avgViews only; these come from long-form applications.
  avgLikes?: number;
  avgComments?: number;
  avgShares?: number;
  reach?: number; // average reach or impressions per post
  engagementRate: number | null; // percent, creator-provided
  audienceCountries: string; // free text, e.g. "India 60%, US 20%"
  ageRange?: string; // one of AGE_RANGES
  frequency?: PostingFrequency;
  niche?: PartnerNiche;
}

export interface PartnerProposal {
  why: string;
  how: string;
  contentType: string;
  posts?: number;
  preference: PartnerPreference;
  compensation: string; // optional, creator's own words
  pastCollabs: string; // optional
  portfolio: string[]; // optional URLs
  extra?: string; // short form: anything else, up to 300 characters
  form?: "short" | "long"; // missing on applications sent before R1289 = long
}

export const PARTNER_OFFER_STATUSES = ["draft", "sent", "accepted", "declined", "withdrawn", "expired"] as const;
export type PartnerOfferStatus = (typeof PARTNER_OFFER_STATUSES)[number];
export const PARTNER_OFFER_TYPES = ["paid", "subscription", "custom"] as const;
export type PartnerOfferType = (typeof PARTNER_OFFER_TYPES)[number];

export const DELIVERABLE_STATUSES = ["planned", "submitted", "published", "verified", "missed"] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];
export const DELIVERABLE_STATUS_LABEL: Record<DeliverableStatus, string> = {
  planned: "Planned",
  submitted: "Submitted",
  published: "Published",
  verified: "Verified",
  missed: "Missed",
};

/** Attached analytics: PNG, JPG or PDF, 8 MB each, at most 6 files per application. */
export const PARTNER_FILE_TYPES = ["image/png", "image/jpeg", "application/pdf"] as const;
export const PARTNER_FILE_MAX_BYTES = 8 * 1024 * 1024;
export const PARTNER_FILE_MAX_COUNT = 6;

/** Referral cookie for outlly.com/?ref=<partnerCode> (separate from the user Refer & Earn cookie ol_ref). */
export const PARTNER_REF_COOKIE = "ol_pref";
export const PARTNER_REF_DAYS = 30;
export const PARTNER_TERMS_VERSION = "2026-11";

/** The exact confirmation copy from the brief. */
export const PARTNER_SUBMITTED_MESSAGE =
  "Your application has been submitted successfully! Our team will review your creator profile and reach out if there's a potential partnership opportunity. Thank you for your interest in growing with Outlly.";
