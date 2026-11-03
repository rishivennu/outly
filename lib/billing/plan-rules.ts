/**
 * 1096 pricing rules. Pure and client-safe, so the limits, the usage meter and the tests all agree.
 *
 * Every new limit is 0 = "not limited" and an empty perk list = "every perk", so plans created before 1096
 * behave exactly as before until an admin (or the 2026-11 preset, applied by hand) sets them.
 */
export const PERKS = ["weekly-digest", "voice-memory", "csv-export", "client-reports", "approvals", "spike-alerts", "ai-replies", "review-links"] as const;
export type Perk = (typeof PERKS)[number];

export const PERK_LABEL: Record<Perk, string> = {
  "weekly-digest": "Weekly digest email",
  "voice-memory": "Voice memory for AI captions",
  "csv-export": "CSV analytics export",
  "client-reports": "Client PDF reports",
  approvals: "Team approvals",
  "spike-alerts": "Spike alerts", // failed-post alerts stay on every plan
  "ai-replies": "AI reply suggestions",
  "review-links": "Review links",
};

/** Stored perks -> list, or null for "every perk" (an empty or unreadable value never takes features away). */
export function parsePerks(raw: unknown): Perk[] | null {
  if (raw == null || raw === "") return null;
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(v)) return null;
  return [...new Set(v.filter((p): p is Perk => (PERKS as readonly string[]).includes(p as string)))];
}

export const serializePerks = (perks: readonly string[] | null) => (perks == null ? "" : JSON.stringify([...new Set(perks.filter((p) => (PERKS as readonly string[]).includes(p)))]));

export const hasPerk = (e: { perks: readonly Perk[] | null }, perk: Perk) => e.perks == null || e.perks.includes(perk);

/** The upgrade message when `perk` isn't on the plan, else null. (lib/billing/entitlements.ts turns these into a 402.) */
export function perkBlock(e: { perks: readonly Perk[] | null; planName: string }, perk: Perk) {
  return hasPerk(e, perk) ? null : `${PERK_LABEL[perk]} isn't part of ${e.planName}. Upgrade in Billing to turn it on.`;
}

/**
 * Free connects "any 3 platforms". `connected` = platforms with a live account right now. Reconnecting a
 * platform already in the list never counts as a new one.
 */
export function platformsBlock(e: { platformLimit: number; planName: string }, connected: readonly string[], platform: string) {
  if (e.platformLimit <= 0) return null;
  const others = [...new Set(connected.filter((p) => p !== platform))];
  if (others.length < e.platformLimit) return null;
  return `${e.planName} connects up to ${e.platformLimit} platforms and you're using ${others.map(platformName).join(", ")}. Disconnect one, or upgrade to post everywhere.`;
}

const NAMES: Record<string, string> = { x: "X", youtube: "YouTube", tiktok: "TikTok", linkedin: "LinkedIn" };
export const platformName = (p: string) => NAMES[p] ?? p.charAt(0).toUpperCase() + p.slice(1);

/** Several accounts per platform? True for the old total-count plans (1037) and for 2+ brands (1096). */
export const isMultiAccount = (e: { accountLimit: number; brandLimit?: number; extraBrands?: number }) => e.accountLimit > 0 || (e.brandLimit ?? 0) + (e.extraBrands ?? 0) > 1;

/**
 * Brands (1096): a brand is one account on each platform, so N brands = up to N accounts per platform.
 * `onPlatform` = accounts already on this platform, not counting the one being (re)connected.
 */
export function brandsBlock(e: { brandLimit: number; extraBrands?: number; planName: string }, onPlatform: number, platform: string) {
  if (e.brandLimit <= 0) return null;
  const max = e.brandLimit + (e.extraBrands ?? 0);
  if (onPlatform < max) return null;
  return `${e.planName} includes ${max} brand${max === 1 ? "" : "s"}, so ${max} ${platformName(platform)} account${max === 1 ? "" : "s"}. Disconnect one, add a brand, or upgrade.`;
}

/** The standard history when a plan sets none (what every plan had before 1096). */
export const DEFAULT_ANALYTICS_DAYS = 90;
export const MAX_ANALYTICS_DAYS = 730;

/** How many days of analytics this plan may read, and whether the request was cut short. */
export function analyticsWindow(e: { analyticsDays: number }, requested: number) {
  const max = Math.min(MAX_ANALYTICS_DAYS, e.analyticsDays > 0 ? e.analyticsDays : DEFAULT_ANALYTICS_DAYS);
  const want = Math.max(7, Math.floor(Number.isFinite(requested) ? requested : 30) || 30);
  return { days: Math.min(want, max), maxDays: max, capped: want > max };
}

/** Range buttons a plan can offer on Analytics. */
export const analyticsRanges = (maxDays: number) => [7, 30, 90, 180, 365, 730].filter((d) => d <= maxDays);

/** Fair use on "unlimited" posts: true the first time this month's count reaches the ceiling (to alert the admin once). */
export const fairUseCrossed = (fairUse: number, usedBefore: number, usedAfter: number) => fairUse > 0 && usedBefore < fairUse && usedAfter >= fairUse;
