import { AI_FEATURE_LABEL, type AiFeature } from "@/lib/ai/features";
import type { Tone } from "./ui";

/** Shared by the server pages and the client panel: a "use client" file must never export values to a server page. */
export type GrantFeaturesView = "all" | AiFeature[];
export type GrantStateView = "active" | "expired" | "revoked";

export const GRANT_TONE: Record<GrantStateView, Tone> = { active: "ok", expired: "muted", revoked: "bad" };

export const featuresText = (f: GrantFeaturesView) => (f === "all" ? "All AI features" : f.map((x) => AI_FEATURE_LABEL[x]).join(", "));
