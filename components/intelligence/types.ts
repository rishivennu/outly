// R1238: the dashboard's data types. Type-only re-exports, so the client never pulls the server-only service in.
export type { Overview } from "@/lib/intelligence/service";
export type { ObjectiveOption } from "@/lib/intelligence/brand-core";
export type { Availability, Confidence, Evidence, FormatGroup, MetricStat, Objective, Period, Recommendation, Signal } from "@/lib/intelligence/core";
// R1248: the stored recommendation rows and their outcomes, type-only for the same reason.
export type { TopicInsight } from "@/lib/intelligence/core";
export type { StoredRecommendation } from "@/lib/intelligence/reco";
export type { StoredOutcome } from "@/lib/intelligence/outcome";
