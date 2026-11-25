import "server-only";
import { entitlements } from "../billing/entitlements";
import { db } from "../db";
import { hasSharedConsent } from "./consent";
import { HttpError } from "../http";
import { accessBlock, intelligenceAccessOf, type Capability, type IntelligenceAccess } from "./entitlements-core";
import { logLearning } from "./learning";

export type { Capability, IntelligenceAccess } from "./entitlements-core";

/**
 * R1334: the server side of plan-based Intelligence access. Every protected operation (route, sweep step, clipper
 * hint, Pip tool, email section) asks here; nothing trusts a client-supplied plan or flag. `entitlements()` is
 * request-cached, so asking several times in one request costs one plan lookup.
 */
export async function intelligenceAccess(userId: string): Promise<IntelligenceAccess> {
  return intelligenceAccessOf(await entitlements(userId));
}

/**
 * Pass, or throw the 402 the web client and the app already turn into an upgrade prompt (PLAN_LIMIT, feature
 * "intelligence", the capability that was asked for). A denial is logged once per owner, capability and UTC day as
 * LearningEvent `entitlement_denied`, so the admin page can count attempts without a new table.
 */
export async function requireIntelligence(userId: string, capability: Capability = "personal_intelligence_enabled"): Promise<IntelligenceAccess> {
  const a = await intelligenceAccess(userId);
  if (a.capabilities[capability]) return a;
  void noteDenied(userId, capability, a);
  throw new HttpError(402, accessBlock(a.planName, capability), "PLAN_LIMIT", { feature: "intelligence", capability, upgrade: a.upgrade ?? "/billing" });
}

/** True when the owner may run `capability`; the no-throw form for jobs and cards. */
export async function hasIntelligence(userId: string, capability: Capability = "personal_intelligence_enabled"): Promise<boolean> {
  return (await intelligenceAccess(userId)).capabilities[capability];
}

/** The subset of `ownerIds` the sweep may build profiles for. One plan lookup per owner, so callers pass the short list they are about to work on. */
export async function entitledOwners(ownerIds: readonly string[], capability: Capability = "personal_learning_enabled"): Promise<Set<string>> {
  const out = new Set<string>();
  for (const id of ownerIds) if (await hasIntelligence(id, capability).catch(() => false)) out.add(id);
  return out;
}

/** Does this owner contribute to the shared baselines? R1335: the consent record decides (AiDataConsent), never the plan. */
export async function contributesShared(userId: string): Promise<boolean> {
  return hasSharedConsent(userId);
}

async function noteDenied(userId: string, capability: Capability, a: IntelligenceAccess) {
  const day = new Date().toISOString().slice(0, 10);
  await logLearning(userId, "entitlement_denied", { dedupeKey: `denied:${capability}:${day}`, data: { capability, plan: a.planSlug, reason: a.reason } }).catch(() => false);
}
