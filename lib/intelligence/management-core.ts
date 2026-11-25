import type { AccessSource } from "../billing/access-core";
import { pickAccess, type AccessCandidate } from "../billing/access-core";
import { parsePerks } from "../billing/plan-rules";
import { intelligenceAccessOf, type AccessReason } from "./entitlements-core";

/**
 * R1337: pure rules behind Admin > AI Management, shared by the server aggregator and the tests. Every number the page
 * shows is derived from rows the caller read; nothing here invents a figure, and nothing here names a creator.
 */

export interface PlanLite {
  slug: string;
  name: string;
  sortOrder: number;
  perks: string;
}

export interface AccessRow {
  userId: string;
  source: AccessSource;
  endsAt: Date | null;
  plan: PlanLite;
}

export interface AccessDistribution {
  /** Accounts on record. */
  users: number;
  /** Accounts with no live subscription or grant: on the Free plan. */
  free: number;
  /** Paid (or granted) accounts whose plan lists the perk. */
  perk: number;
  /** Paid accounts on a plan made before perks existed (every perk): the engine is on. */
  legacyPaid: number;
  /** Paid accounts whose plan lists its perks without this one: the engine is off. */
  planWithoutPerk: number;
  /** perk + legacyPaid (+ free when the Free plan lists the perk). */
  withAccess: number;
  /** True when the Free plan itself lists the perk (Admin > Pricing can do that); then "free" accounts have the engine. */
  freePlanGrantsAccess: boolean;
  byPlan: { planSlug: string; planName: string; users: number; enabled: boolean; reason: AccessReason }[];
  bySource: Record<AccessSource, number>;
  /** The subscription or grant read hit its cap, so the split may be short. */
  truncated: boolean;
}

/**
 * The same decision `entitlements()` makes per request, run once over every live candidate: the best plan per account
 * (pickAccess), then the perk rule (intelligenceAccessOf). Accounts with no candidate are on the Free plan.
 */
export function accessDistribution(input: { users: number; candidates: readonly AccessRow[]; freePlan: PlanLite | null; truncated?: boolean }): AccessDistribution {
  const byUser = new Map<string, AccessCandidate<PlanLite>[]>();
  for (const c of input.candidates) (byUser.get(c.userId) ?? byUser.set(c.userId, []).get(c.userId)!).push({ plan: c.plan, source: c.source, endsAt: c.endsAt });
  const out: AccessDistribution = {
    users: input.users,
    free: 0,
    perk: 0,
    legacyPaid: 0,
    planWithoutPerk: 0,
    withAccess: 0,
    freePlanGrantsAccess: false,
    byPlan: [],
    bySource: { free: 0, paid: 0, gift: 0, admin: 0, referral: 0 },
    truncated: !!input.truncated,
  };
  const plans = new Map<string, AccessDistribution["byPlan"][number]>();
  const tally = (plan: PlanLite, source: AccessSource, n: number) => {
    const a = intelligenceAccessOf({ perks: parsePerks(plan.perks), source, planSlug: plan.slug, planName: plan.name });
    if (a.reason === "free") out.free += n;
    else if (a.reason === "perk") out.perk += n;
    else if (a.reason === "legacy-paid") out.legacyPaid += n;
    else out.planWithoutPerk += n;
    if (a.enabled) out.withAccess += n;
    out.bySource[source] += n;
    const row = plans.get(plan.slug) ?? { planSlug: plan.slug, planName: plan.name, users: 0, enabled: a.enabled, reason: a.reason };
    row.users += n;
    plans.set(plan.slug, row);
    return a;
  };
  for (const cands of byUser.values()) {
    const best = pickAccess(cands);
    if (best) tally(best.plan, best.source, 1);
  }
  const onFree = Math.max(0, input.users - byUser.size);
  if (input.freePlan) {
    const a = tally(input.freePlan, "free", onFree);
    out.freePlanGrantsAccess = a.enabled;
    // A Free plan that lists the perk is "perk" by the rule above; the page says Free, so move the count back.
    if (a.enabled) {
      out.perk -= onFree;
      out.free += onFree;
    }
  } else {
    out.free += onFree;
    out.bySource.free += onFree;
  }
  out.byPlan = [...plans.values()].sort((a, b) => b.users - a.users || a.planSlug.localeCompare(b.planSlug));
  return out;
}

/** Entitlement denials, from LearningEvent `entitlement_denied` rows (one per owner, capability and UTC day). */
export interface DenialSummary {
  total: number;
  owners: number;
  last7d: number;
  byCapability: Record<string, number>;
  byReason: Record<string, number>;
  lastAt: string | null;
}

export function summarizeDenials(rows: readonly { ownerId: string; data: string | null; at: Date | string }[], now: Date): DenialSummary {
  const week = now.getTime() - 7 * 864e5;
  const owners = new Set<string>();
  const byCapability: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  let last7d = 0;
  let lastAt = 0;
  for (const r of rows) {
    owners.add(r.ownerId);
    const at = new Date(r.at).getTime();
    if (at >= week) last7d++;
    if (at > lastAt) lastAt = at;
    let d: { capability?: unknown; reason?: unknown } = {};
    try {
      d = r.data ? JSON.parse(r.data) : {};
    } catch {
      d = {};
    }
    const cap = typeof d.capability === "string" ? d.capability : "unknown";
    const reason = typeof d.reason === "string" ? d.reason : "unknown";
    byCapability[cap] = (byCapability[cap] ?? 0) + 1;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  return { total: rows.length, owners: owners.size, last7d, byCapability, byReason, lastAt: lastAt ? new Date(lastAt).toISOString() : null };
}

/** One retention rule and whether the oldest row on record respects it (a day of grace for the sweep's cadence). */
export interface RetentionLine {
  key: string;
  label: string;
  days: number;
  oldestAt: string | null;
  oldestAgeDays: number | null;
  status: "ok" | "overdue" | "empty";
}

export function retentionLine(key: string, label: string, days: number, oldestAt: Date | string | null | undefined, now: Date): RetentionLine {
  if (!oldestAt) return { key, label, days, oldestAt: null, oldestAgeDays: null, status: "empty" };
  const age = (now.getTime() - new Date(oldestAt).getTime()) / 864e5;
  const ageDays = Math.max(0, Math.floor(age));
  return { key, label, days, oldestAt: new Date(oldestAt).toISOString(), oldestAgeDays: ageDays, status: age > days + 1 ? "overdue" : "ok" };
}

/** Profile freshness against the sweep's staleness rule. */
export function freshnessOf(input: { total: number; fresh: number; oldestAt: Date | string | null | undefined; staleMs: number }, now: Date) {
  const oldest = input.oldestAt ? new Date(input.oldestAt) : null;
  return {
    total: input.total,
    fresh: input.fresh,
    stale: Math.max(0, input.total - input.fresh),
    staleHours: Math.round(input.staleMs / 36e5),
    oldestAt: oldest ? oldest.toISOString() : null,
    oldestAgeHours: oldest ? Math.max(0, Math.round((now.getTime() - oldest.getTime()) / 36e5)) : null,
  };
}

/** The ids in `ownerIds` that are not in `knownUsers`: rows that outlived their account. */
export function orphanedOwners(ownerIds: readonly string[], knownUsers: ReadonlySet<string>): number {
  let n = 0;
  for (const id of new Set(ownerIds)) if (!knownUsers.has(id)) n++;
  return n;
}

export type IsolationVerdict = "verified" | "attention" | "unverified";

/** The isolation checks the page can actually run, and one word for the lot. */
export function isolationVerdict(checks: readonly { ok: boolean | null }[]): IsolationVerdict {
  if (checks.some((c) => c.ok === false)) return "attention";
  if (checks.every((c) => c.ok === null)) return "unverified";
  return "verified";
}
