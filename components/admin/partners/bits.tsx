import { Globe } from "lucide-react";
import { BrandGlyph } from "@/components/brand/brands";
import { StatusBadge } from "@/components/admin/ui";
import { cn } from "@/lib/utils";
import {
  PARTNER_FORMAT_LABEL,
  PARTNER_NICHE_LABEL,
  PARTNER_PLATFORM_LABEL,
  PARTNER_PREFERENCE_LABEL,
  PARTNER_STATUS_LABEL,
  PARTNER_STATUS_TONE,
  PARTNER_TIER_LABEL,
  type PartnerStatus,
} from "@/lib/partners/types";

/**
 * StatusBadge picks its colour from the shared vocabulary in components/admin/ui.tsx, so each partner tone borrows
 * the key that already carries that colour there; the partner label is what the reader sees.
 */
const TONE_KEY = { neutral: "canceled", info: "queued", success: "active", warning: "past_due", danger: "failed" } as const;

export function PartnerStatusBadge({ status, size = "md" }: { status: string; size?: "sm" | "md" }) {
  const s = status as PartnerStatus;
  const tone = PARTNER_STATUS_TONE[s] ?? "neutral";
  return <StatusBadge status={TONE_KEY[tone]} label={PARTNER_STATUS_LABEL[s] ?? status} size={size} />;
}

const GLYPH = { instagram: "instagram", youtube: "youtube", tiktok: "tiktok", x: "x", linkedin: "linkedin", facebook: "facebook", threads: "threads" } as const;

/** One-colour platform mark; decorative, the platform name is always in text beside it or in its label. */
export function PlatformMark({ platform, className }: { platform: string; className?: string }) {
  const g = GLYPH[platform as keyof typeof GLYPH];
  return g ? <BrandGlyph brand={g} className={cn("h-4 w-4 shrink-0", className)} /> : <Globe className={cn("h-4 w-4 shrink-0", className)} aria-hidden />;
}

const label = <T extends Record<string, string>>(map: T, v: string | null | undefined) => (v ? (map as Record<string, string>)[v] ?? v : "");
export const platformLabel = (v: string | null | undefined) => label(PARTNER_PLATFORM_LABEL, v) || "Not given";
export const nicheLabel = (v: string | null | undefined) => label(PARTNER_NICHE_LABEL, v) || "Not given";
export const formatLabel = (v: string | null | undefined) => label(PARTNER_FORMAT_LABEL, v) || "Not given";
export const preferenceLabel = (v: string | null | undefined) => label(PARTNER_PREFERENCE_LABEL, v) || "Not given";
export const tierLabel = (v: string | null | undefined) => label(PARTNER_TIER_LABEL, v) || "Not given";

const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-IN");
export const fmtCount = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? (n >= 1_000 ? compact.format(n) : whole.format(n)) : "Not given");
export const fmtWhole = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? whole.format(n) : "Not given");
export const fmtRate = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? `${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%` : "Not given");

/** History wording for PartnerEvent.action (status moves read from/to; the rest by name). */
export const EVENT_LABEL: Record<string, string> = {
  status: "Status changed",
  note: "Internal note added",
  submitted: "Application submitted",
  file: "File attached",
  offer_created: "Offer drafted",
  offer_updated: "Offer updated",
  offer_sent: "Offer sent",
  offer_accepted: "Offer accepted",
  offer_declined: "Offer declined",
  offer_withdrawn: "Offer withdrawn",
  benefit_granted: "Benefit granted",
  benefit_extended: "Benefit extended",
  benefit_changed: "Benefit changed",
  benefit_ended: "Benefit ended",
  deliverable: "Deliverable updated",
  code: "Referral code set",
  email: "Email sent",
};
export const eventLabel = (action: string) => EVENT_LABEL[action] ?? action.replace(/[_.]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** List sort choices (URL `sort`): "" newest, "oldest", or a numeric column, largest first. */
export const SORT_OPTS = [
  { value: "", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "followers", label: "Most followers" },
  { value: "avgViews", label: "Most average views" },
  { value: "engagementRate", label: "Highest engagement" },
];
