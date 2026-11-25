import "server-only";
import { db } from "../db";
import { isPaidSub, type AccessSource } from "../billing/access-core";
import { CONSENT_CATEGORIES, CONSENT_POLICY_VERSION } from "./consent-core";
import { consentSummary, pendingDeletions, type ConsentSummary } from "./consent";
import { buildsSummary, type BuildsSummary } from "./shared-lineage";
import { SHARED_BUILD_RETENTION_DAYS } from "./shared-lineage-core";
import { SHARED_MODEL_KEY } from "./shared";
import { PROFILE_STALE_MS } from "./profile";
import { jobsSummary, type JobsSummary } from "./jobs";
import { INTELLIGENCE_JOB_RETENTION_DAYS } from "./jobs-core";
import { CAPABILITIES } from "./entitlements-core";
import { accessDistribution, freshnessOf, isolationVerdict, orphanedOwners, retentionLine, summarizeDenials, type AccessDistribution, type DenialSummary, type IsolationVerdict, type RetentionLine } from "./management-core";

/**
 * R1337: everything Admin > AI Management shows, read in one call. Five sections, every number derived from rows:
 * who has the engine (the plan rule run over every live subscription and grant), who consented to the shared model,
 * what the shared training pipeline did, how the personal engine is keeping up, and the privacy ledger. Where a figure
 * is not measured (an on-demand latency before the first forecast) the field is null and the page says so.
 */
export interface IntelligenceManagement {
  at: string;
  access: AccessDistribution;
  denials: DenialSummary;
  consent: ConsentSummary & { policyVersion: string; categories: readonly string[] };
  shared: {
    builds: BuildsSummary;
    /** Status of the stored shared document (active | retired | candidate) or null before the first build. */
    production: { key: string; status: string; featureVersion: number; updatedAt: string | null } | null;
    /** Creators the shared model can read (newest decision granted) against those with measured posts at all. */
    eligible: { consented: number; withMeasuredPosts: number; excludedWithData: number };
    /** Compute spent on builds in 30 days. Builds run inside the sweep on the web host, so this is time, not money. */
    compute30d: { builds: number; totalMs: number; meanMs: number | null };
  };
  personal: {
    profiles: { owners: number; rows: number; byLevel: Record<string, number>; freshness: ReturnType<typeof freshnessOf> };
    /** Profile owners who no longer have the engine (downgraded): kept as data, never rebuilt. */
    retainedWithoutAccess: number;
    /** Accounts with the engine and no workspace profile yet: the cold start, or no published post in the window. */
    entitledWithoutProfile: number;
    predictions: { total: number; evaluated: number; stored7d: number };
    jobs: JobsSummary;
  };
  privacy: {
    decisions: { total: number; last30d: { granted: number; withdrawn: number }; lastAt: string | null };
    deletions: { open: number; done: number; oldestOpenAt: string | null };
    retention: RetentionLine[];
    isolation: { verdict: IsolationVerdict; checks: { key: string; label: string; ok: boolean | null; detail: string }[] };
  };
}

export async function intelligenceManagement(now: Date = new Date()): Promise<IntelligenceManagement> {
  const since30 = new Date(now.getTime() - 30 * 864e5);
  const since7 = new Date(now.getTime() - 7 * 864e5);
  const fresh = new Date(now.getTime() - PROFILE_STALE_MS);
  const CAP = 20_000;
  const planSelect = { select: { slug: true, name: true, sortOrder: true, perks: true } } as const;

  const [users, subs, grants, freePlan, denied, consent, builds, sharedRow, measuredOwners, buildAgg, oldestBuild, profileOwners, byLevel, freshCount, oldestProfile, predTotal, predEval, stored7d, jobs, open, decisionsTotal, lastDecision] = await Promise.all([
    db.user.count(),
    db.subscription.findMany({ where: { status: "active", currentPeriodEnd: { gt: now }, OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }] }, select: { userId: true, provider: true, priceMinor: true, sample: true, currentPeriodEnd: true, plan: planSelect }, take: CAP }),
    db.planGrant.findMany({ where: { status: "active", startsAt: { lte: now }, endsAt: { gt: now }, userId: { not: null } }, select: { userId: true, source: true, endsAt: true, plan: planSelect }, take: CAP }),
    db.plan.findUnique({ where: { slug: "free" }, ...planSelect }),
    db.learningEvent.findMany({ where: { type: "entitlement_denied", at: { gte: since30 } }, select: { ownerId: true, data: true, at: true }, take: CAP }),
    consentSummary(now),
    buildsSummary(now),
    db.modelVersion.findUnique({ where: { key: SHARED_MODEL_KEY }, select: { status: true, featureVersion: true, createdAt: true } }),
    db.contentFeature.findMany({ where: { measured: true }, distinct: ["ownerId"], select: { ownerId: true } }).then((g) => g.length),
    db.sharedDatasetBuild.aggregate({ where: { builtAt: { gte: since30 } }, _sum: { durationMs: true }, _count: { _all: true } }),
    db.sharedDatasetBuild.findFirst({ orderBy: { builtAt: "asc" }, select: { builtAt: true } }),
    db.creatorProfile.findMany({ where: { scopeKey: "", platform: "" }, select: { ownerId: true }, take: CAP }),
    db.creatorProfile.groupBy({ by: ["level"], where: { scopeKey: "", platform: "" }, _count: { _all: true } }),
    db.creatorProfile.count({ where: { scopeKey: "", platform: "", computedAt: { gte: fresh } } }),
    db.creatorProfile.findFirst({ where: { scopeKey: "", platform: "" }, orderBy: { computedAt: "asc" }, select: { computedAt: true } }),
    db.predictionRecord.count(),
    db.predictionRecord.count({ where: { evaluatedAt: { not: null } } }),
    db.predictionRecord.count({ where: { createdAt: { gte: since7 } } }),
    jobsSummary(now),
    pendingDeletions(),
    db.aiDataConsent.count(),
    db.aiDataConsent.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  const access = accessDistribution({
    users,
    candidates: [
      ...subs.map((s) => ({ userId: s.userId, source: (isPaidSub(s) ? "paid" : "gift") as AccessSource, endsAt: s.currentPeriodEnd, plan: s.plan })),
      ...grants.map((g) => ({ userId: g.userId as string, source: (g.source === "referral" ? "referral" : "admin") as AccessSource, endsAt: g.endsAt, plan: g.plan })),
    ],
    freePlan,
    truncated: subs.length >= CAP || grants.length >= CAP,
  });

  // Who, among the profile owners, still has the engine: the same candidates, per owner (the list is the short one).
  const enabledOwners = enabledSet(subs, grants, freePlan);
  const owners = [...new Set(profileOwners.map((p) => p.ownerId))];
  const retainedWithoutAccess = enabledOwners.freeEnabled ? 0 : owners.filter((id) => !enabledOwners.has(id)).length;
  const entitledWithoutProfile = Math.max(0, access.withAccess - (owners.length - retainedWithoutAccess));

  // Isolation: rows that outlived their account would be a leak path; the shared document is checked by every build.
  const known = owners.length ? new Set((await db.user.findMany({ where: { id: { in: owners.slice(0, CAP) } }, select: { id: true } })).map((u) => u.id)) : new Set<string>();
  const orphans = orphanedOwners(owners, known);
  const latest = builds.latest;
  const checks: IntelligenceManagement["privacy"]["isolation"]["checks"] = [
    { key: "shared-validation", label: "Shared document carries no creator id and every bucket clears the floors", ok: latest ? latest.validation === "passed" : null, detail: latest ? `${latest.datasetVersion}: ${latest.validation}${latest.anomaly ? ` (${latest.anomaly})` : ""}` : "No build yet." },
    { key: "consent-only", label: "Shared document reads consented creators only", ok: latest ? latest.contributors <= consent.granted + consent.withdrawn : null, detail: latest ? `${latest.contributors} contributors read against ${consent.granted} consented now.` : "No build yet." },
    { key: "mirrors", label: "Consent mirror (User.shareLearning) agrees with the consent record", ok: consent.staleMirrors === 0, detail: consent.staleMirrors ? `${consent.staleMirrors} account${consent.staleMirrors === 1 ? "" : "s"} out of step; the next sweep rewrites the mirror.` : "Every mirror matches." },
    { key: "orphans", label: "No personal profile outlives its account", ok: orphans === 0, detail: orphans ? `${orphans} profile owner${orphans === 1 ? "" : "s"} no longer exist.` : `${owners.length} profile owners checked.` },
    { key: "lineage", label: "Lineage rows hold a pseudonymous key, never a user id", ok: true, detail: "By schema: SharedContribution has no user column (HMAC of the owner id)." },
  ];

  return {
    at: now.toISOString(),
    access,
    denials: summarizeDenials(denied, now),
    consent: { ...consent, policyVersion: CONSENT_POLICY_VERSION, categories: CONSENT_CATEGORIES },
    shared: {
      builds,
      production: sharedRow ? { key: SHARED_MODEL_KEY, status: sharedRow.status, featureVersion: sharedRow.featureVersion, updatedAt: latest?.builtAt ?? sharedRow.createdAt.toISOString() } : null,
      eligible: { consented: consent.granted, withMeasuredPosts: measuredOwners, excludedWithData: Math.max(0, measuredOwners - consent.granted) },
      compute30d: { builds: buildAgg._count._all, totalMs: buildAgg._sum.durationMs ?? 0, meanMs: buildAgg._count._all ? Math.round((buildAgg._sum.durationMs ?? 0) / buildAgg._count._all) : null },
    },
    personal: {
      profiles: {
        owners: owners.length,
        rows: profileOwners.length,
        byLevel: Object.fromEntries(byLevel.map((l) => [l.level, l._count._all])),
        freshness: freshnessOf({ total: profileOwners.length, fresh: freshCount, oldestAt: oldestProfile?.computedAt ?? null, staleMs: PROFILE_STALE_MS }, now),
      },
      retainedWithoutAccess,
      entitledWithoutProfile,
      predictions: { total: predTotal, evaluated: predEval, stored7d },
      jobs,
    },
    privacy: {
      decisions: { total: decisionsTotal, last30d: consent.decisions30d, lastAt: lastDecision ? lastDecision.createdAt.toISOString() : null },
      deletions: { open: consent.deletionsOpen, done: consent.deletionsDone, oldestOpenAt: open.length ? new Date(Math.min(...open.map((d) => d.requestedAt.getTime()))).toISOString() : null },
      retention: [
        retentionLine("builds", "Shared model build records", SHARED_BUILD_RETENTION_DAYS, oldestBuild?.builtAt, now),
        retentionLine("jobs", "Intelligence job log", INTELLIGENCE_JOB_RETENTION_DAYS, jobs.oldestRowAt, now),
      ],
      isolation: { verdict: isolationVerdict(checks), checks },
    },
  };
}

/** The capability list the page explains denials against (labels live in entitlements-core). */
export const DENIAL_CAPABILITIES = CAPABILITIES;

type SubLite = { userId: string; provider: string; priceMinor: number; sample: boolean; currentPeriodEnd: Date; plan: { slug: string; name: string; sortOrder: number; perks: string } };
type GrantLite = { userId: string | null; source: string; endsAt: Date; plan: { slug: string; name: string; sortOrder: number; perks: string } };

/** Owner ids with the engine on, from the same live candidates the distribution used (no second read). */
function enabledSet(subs: readonly SubLite[], grants: readonly GrantLite[], freePlan: { slug: string; name: string; sortOrder: number; perks: string } | null): Set<string> & { freeEnabled: boolean } {
  const per = new Map<string, { userId: string; source: "paid" | "gift" | "admin" | "referral"; endsAt: Date | null; plan: SubLite["plan"] }[]>();
  for (const s of subs) (per.get(s.userId) ?? per.set(s.userId, []).get(s.userId)!).push({ userId: s.userId, source: isPaidSub(s) ? "paid" : "gift", endsAt: s.currentPeriodEnd, plan: s.plan });
  for (const g of grants) if (g.userId) (per.get(g.userId) ?? per.set(g.userId, []).get(g.userId)!).push({ userId: g.userId, source: g.source === "referral" ? "referral" : "admin", endsAt: g.endsAt, plan: g.plan });
  const out = new Set<string>() as Set<string> & { freeEnabled: boolean };
  for (const [userId, cands] of per) {
    const d = accessDistribution({ users: 1, candidates: cands, freePlan: null });
    if (d.withAccess) out.add(userId);
  }
  out.freeEnabled = freePlan ? accessDistribution({ users: 1, candidates: [], freePlan }).freePlanGrantsAccess : false;
  return out;
}
