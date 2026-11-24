import "server-only";
import { periodOf } from "./core";
import { PROFILE_WINDOW_DAYS } from "./profile-core";
import { modelStates } from "./model/predict";
import { persistRecommendations, storedFor, type StoredRecommendation } from "./reco";
import { ACTIVE_STATUSES } from "./reco-core";
import { personalRecommendations, type PersonalDrafts } from "./personal-reco-core";

/**
 * R1320: the stored side of personal recommendations. The drafts come from the creator's own model states
 * (./personal-reco-core.ts); this file stores them through the same idempotent path as the workspace engine's
 * (./reco.ts), under the scope they belong to, so they share ids, statuses, the planner's actions and expiry.
 */

export interface PersonalRead extends Omit<PersonalDrafts, "recommendations"> {
  recommendations: StoredRecommendation[];
  window: { from: string; to: string; label: string };
}

export async function personalRead(ownerId: string, opts: { scopeKey?: string; targetIds?: string[] | null; now?: number; readOnly?: boolean } = {}): Promise<PersonalRead> {
  const now = opts.now ?? Date.now();
  const scopeKey = opts.scopeKey ?? "";
  const period = periodOf(now, PROFILE_WINDOW_DAYS);
  const window = { from: period.from, to: period.to, label: period.label };
  const states = await modelStates(ownerId, { scopeKey, targetIds: opts.targetIds, now });
  const drafts = personalRecommendations({ states, window });
  const stored = opts.readOnly
    ? await storedFor(ownerId, scopeKey, drafts.recommendations, period, now)
    : await persistRecommendations(ownerId, scopeKey, drafts.recommendations, period, { now });
  const recommendations = stored.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const reason = recommendations.length ? null : (drafts.reason ?? "Nothing new: you have already closed the personal recommendations your numbers support.");
  return { recommendations, reason, levels: drafts.levels, window };
}
