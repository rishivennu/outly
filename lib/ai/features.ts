/** Phase 3 (A4/A5): the AI features an admin can grant unlimited access to, one id per metered AI call site.
 * Shared by quota enforcement (lib/ai-quota.ts), entitlements (lib/ai/entitlements.ts), admin UI and monitoring. */
export const AI_FEATURES = ["captions", "transcription", "translation", "rewrite", "content", "other", "intelligence_wording"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_FEATURE_LABEL: Record<AiFeature, string> = {
  captions: "Caption generation",
  transcription: "Transcription",
  translation: "Translation",
  rewrite: "Caption rewriting",
  content: "Content generation",
  other: "Other AI features",
  intelligence_wording: "Recommendation wording", // R1244: AI rewording of Content Intelligence recommendations
};

export const isAiFeature = (v: unknown): v is AiFeature => typeof v === "string" && (AI_FEATURES as readonly string[]).includes(v);
