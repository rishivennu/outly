import type { Perk } from "../billing/plan-rules";

/**
 * R1334: who gets the Personal Intelligence engine. Pure and client-safe, so the page, the routes, the sweep and the
 * tests all agree. One configurable plan perk decides (`personal-intelligence`, set per plan in Admin > Pricing); the
 * five logical capabilities the product talks about are derived from it here, so a future split of the perk changes
 * one function, not every caller. Nothing in this file knows a plan's name or price.
 *
 * Shared-model contribution is NOT a capability: it is consent, owned by the creator, independent of the plan
 * (lib/intelligence/shared.ts, `User.shareLearning`).
 */
export const INTELLIGENCE_PERK: Perk = "personal-intelligence";

export const CAPABILITIES = [
  "personal_intelligence_enabled",
  "personalized_predictions_enabled",
  "personalized_recommendations_enabled",
  "personalized_clip_ranking_enabled",
  "personal_learning_enabled",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABEL: Record<Capability, string> = {
  personal_intelligence_enabled: "Personal Intelligence",
  personalized_predictions_enabled: "your forecasts",
  personalized_recommendations_enabled: "made-for-you recommendations",
  personalized_clip_ranking_enabled: "clip ranking from your own history",
  personal_learning_enabled: "learning from your posts",
};

/** Why the engine is on or off, for the admin page and the tests; never shown to the creator as is. */
export type AccessReason = "perk" | "legacy-paid" | "free" | "plan-without-perk";

export interface IntelligenceAccess {
  enabled: boolean;
  capabilities: Record<Capability, boolean>;
  reason: AccessReason;
  planSlug: string;
  planName: string;
  source: string;
  /** Where to send a creator who wants it, or null when they have it. */
  upgrade: string | null;
}

/**
 * A plan that lists its perks decides; a plan made before 1096 (perks null = every perk) gets the engine when it is
 * paid, never on Free. Mirrors the `ai-insights` rule in reco.ts so the two paid Intelligence features never disagree.
 */
export function intelligenceAccessOf(e: { perks: readonly Perk[] | null; source: string; planSlug: string; planName: string }): IntelligenceAccess {
  let enabled: boolean;
  let reason: AccessReason;
  if (e.perks == null) {
    enabled = e.source !== "free";
    reason = enabled ? "legacy-paid" : "free";
  } else {
    enabled = e.perks.includes(INTELLIGENCE_PERK);
    reason = enabled ? "perk" : e.source === "free" ? "free" : "plan-without-perk";
  }
  const capabilities = Object.fromEntries(CAPABILITIES.map((c) => [c, enabled])) as Record<Capability, boolean>;
  return { enabled, capabilities, reason, planSlug: e.planSlug, planName: e.planName, source: e.source, upgrade: enabled ? null : "/billing" };
}

/** The 402's message: what is missing and where to turn it on. Same voice as perkBlock. */
export const accessBlock = (planName: string, capability: Capability = "personal_intelligence_enabled") =>
  capability === "personal_intelligence_enabled"
    ? `Personal Intelligence isn't part of ${planName}. Upgrade in Billing to turn on your profile, forecasts and made-for-you recommendations.`
    : `Personal Intelligence (${CAPABILITY_LABEL[capability]}) isn't part of ${planName}. Upgrade in Billing to turn it on.`;

/** The honest upgrade explanation on /intelligence for a creator without the engine (no locked fake cards). */
export const UPGRADE_COPY = {
  title: "Personal Intelligence",
  body: "A model of your own channel, built only from your published posts and their measured results. It is part of the paid plans.",
  points: [
    "Your baselines: what a post of each format usually does for you, per platform, with the sample it rests on.",
    "Forecasts: a range for a draft before it goes out, judged against the real number a week later.",
    "Made for you: recommendations from your own lifts, with both sides of the evidence.",
    "Clip ranking that leans on what has worked for you, not only on general rules.",
    "A weekly accuracy line, so you can see when the model knows you and when it is still guessing.",
  ],
  note: "Nothing here is generated for you until you upgrade; the engine learns only from the data your plan allows it to use.",
} as const;

/** Shown to an entitled creator whose profile is not built yet (spec §4): never a made-up number. */
export const COLD_START_COPY = "Your Intelligence Engine is getting to know your content. As more performance data becomes available, your insights will become more personalized.";

/** What an unentitled client gets back from the soft reads (/insights, /pulse): the flag and the door, no numbers. */
export const notEntitledView = (a: IntelligenceAccess) => ({ entitled: false as const, planName: a.planName, upgrade: a.upgrade ?? "/billing", message: accessBlock(a.planName) });
