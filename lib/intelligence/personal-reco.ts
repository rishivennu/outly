import "server-only";
import { db } from "../db";
import { requireIntelligence } from "./entitlements";
import { periodOf } from "./core";
import { HISTORY_DAYS, modelStates, type ModelState } from "./model/predict";
import { persistRecommendations, storedFor, type StoredRecommendation } from "./reco";
import { ACTIVE_STATUSES, ruleKeyOf } from "./reco-core";
import { PERSONAL_ID_PREFIX, personalRecommendations, type PersonalDrafts } from "./personal-reco-core";

/**
 * R1320: the stored side of personal recommendations. The drafts come from the creator's own model states
 * (./personal-reco-core.ts); this file stores them through the same idempotent path as the workspace engine's
 * (./reco.ts), under the scope they belong to, so they share ids, statuses, the planner's actions and expiry.
 */

export interface PersonalRead extends Omit<PersonalDrafts, "recommendations"> {
  recommendations: StoredRecommendation[];
  window: { from: string; to: string; label: string };
}

export async function personalRead(ownerId: string, opts: { scopeKey?: string; targetIds?: string[] | null; now?: number; readOnly?: boolean; states?: ModelState[] } = {}): Promise<PersonalRead> {
  await requireIntelligence(ownerId, "personalized_recommendations_enabled"); // R1334: inference and storage are paid
  const now = opts.now ?? Date.now();
  const scopeKey = opts.scopeKey ?? "";
  // The states are computed over the model's HISTORY_DAYS, so the window the cards name is that one.
  const period = periodOf(now, HISTORY_DAYS);
  const window = { from: period.from, to: period.to, label: period.label };
  // R1326 review: a caller that already has the states (the pulse) passes them, so the model is read once.
  const states = opts.states ?? (await modelStates(ownerId, { scopeKey, targetIds: opts.targetIds, now }));
  const drafts = personalRecommendations({ states, window });
  const stored = opts.readOnly
    ? await storedFor(ownerId, scopeKey, drafts.recommendations, period, now)
    : await persistRecommendations(ownerId, scopeKey, drafts.recommendations, period, { now });
  if (!opts.readOnly) await retireStale(ownerId, scopeKey, drafts.recommendations.map(ruleKeyOf), now);
  const recommendations = stored.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const reason = recommendations.length ? null : (drafts.reason ?? "Nothing new: you have already closed the personal recommendations your numbers support.");
  return { recommendations, reason, levels: drafts.levels, window };
}

/**
 * An open personal row whose rule the numbers no longer support (a lift that flipped, a format no longer ahead) is
 * expired here, so the creator never sees advice beside the numbers that contradict it. Rows the creator acted on
 * (accepted, saved, edited) are theirs and stay.
 */
async function retireStale(ownerId: string, scopeKey: string, liveRules: string[], now: number): Promise<number> {
  const open = await db.recommendation.findMany({ where: { ownerId, scopeKey, status: "open", evidence: { contains: `"rule":"${PERSONAL_ID_PREFIX}` } }, select: { id: true, evidence: true }, take: 100 });
  const keep = new Set(liveRules);
  const gone = open.filter((r) => {
    try {
      const rule = (JSON.parse(r.evidence) as { rule?: string }).rule ?? "";
      return rule.startsWith(PERSONAL_ID_PREFIX) && !keep.has(rule);
    } catch {
      return false;
    }
  });
  if (!gone.length) return 0;
  const ids = gone.map((r) => r.id);
  const n = await db.recommendation.updateMany({ where: { id: { in: ids }, ownerId, status: "open" }, data: { status: "expired" } });
  await db.recommendationEvent.createMany({ data: ids.map((id) => ({ recommendationId: id, type: "expired", data: JSON.stringify({ by: "personal", reason: "numbers moved" }), at: new Date(now) })) });
  return n.count;
}
