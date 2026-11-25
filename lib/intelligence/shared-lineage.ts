import "server-only";
import { db } from "../db";
import { hmac } from "../crypto";
import { CONSENT_TYPE } from "./consent-core";
import { SHARED_BUILD_RETENTION_DAYS, SHARED_CONTRIBUTION_REFS_MAX, buildLine, datasetVersion, type SharedEvaluation, type SharedRejections } from "./shared-lineage-core";

/**
 * R1336: the shared pipeline's bookkeeping, stored. A SharedDatasetBuild row per rebuild (counts, rejections, validation,
 * evaluation, served or not) and one SharedContribution row per pseudonymous contributor, kept current by every build.
 * The pseudonym is an HMAC of the owner id under AUTH_SECRET: the rows carry no user id, and the only way from a row
 * back to a person is the key plus the id, held apart from this table. A deletion request clears the references.
 *
 * The data is pseudonymised, not anonymous (the key exists); the served document (bucket medians) is what readers get.
 */

export function contributorKey(ownerId: string): string {
  return hmac(`shared-contributor:${ownerId}`).slice(0, 32);
}

export interface BuildInput {
  trigger: "sweep" | "deletion" | "admin";
  featureVersion: number;
  sharedVersion: number;
  policyVersion: string;
  sourceCategories: readonly string[];
  contributors: number;
  rowsRead: number;
  rowsKept: number;
  rejected: SharedRejections;
  buckets: number;
  validation: { ok: boolean; notes: string[] };
  evaluation: SharedEvaluation;
  served: boolean;
  durationMs: number;
  builtAt: Date;
}

export interface BuildRow {
  id: string;
  seq: number;
  datasetVersion: string;
  anomaly: string | null;
  served: boolean;
  validation: string;
}

/** Store the build. `seq` is max + 1; a race on the unique index retries once. Flags the admins when something is off. */
export async function recordBuild(input: BuildInput): Promise<BuildRow> {
  const anomaly = !input.validation.ok ? `validation failed: ${input.validation.notes.join("; ")}` : input.evaluation.anomaly;
  const data = {
    featureVersion: input.featureVersion,
    sharedVersion: input.sharedVersion,
    policyVersion: input.policyVersion,
    sourceCategories: JSON.stringify(input.sourceCategories),
    trigger: input.trigger,
    contributors: input.contributors,
    rowsRead: input.rowsRead,
    rowsKept: input.rowsKept,
    rejected: JSON.stringify(input.rejected),
    buckets: input.buckets,
    validation: input.validation.ok ? "passed" : "failed",
    validationNotes: input.validation.notes.length ? JSON.stringify(input.validation.notes) : null,
    evaluation: JSON.stringify(input.evaluation),
    anomaly,
    served: input.served,
    durationMs: input.durationMs,
    builtAt: input.builtAt,
  };
  let row: BuildRow | null = null;
  for (let attempt = 0; attempt < 2 && !row; attempt++) {
    const last = await db.sharedDatasetBuild.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } });
    const seq = (last?.seq ?? 0) + 1;
    try {
      row = await db.sharedDatasetBuild.create({ data: { seq, datasetVersion: datasetVersion(seq), ...data }, select: { id: true, seq: true, datasetVersion: true, anomaly: true, served: true, validation: true } });
    } catch (e) {
      if (attempt === 1) throw e;
    }
  }
  const b = row!;
  if (anomaly) {
    // The admin feed (AdminEvent, same row lib/admin/route.ts adminEvent writes; written directly so the sweep does not load the admin session stack).
    await db.adminEvent
      .create({
        data: {
          kind: "intelligence_build",
          title: input.validation.ok ? `Shared model build ${b.datasetVersion} served with a flag` : `Shared model build ${b.datasetVersion} failed validation; an empty document is served`,
          body: buildLine({ seq: b.seq, contributors: input.contributors, rowsKept: input.rowsKept, buckets: input.buckets, validation: b.validation, served: b.served, anomaly }),
          href: "/admin/intelligence",
        },
      })
      .catch(() => {});
  }
  return b;
}

/** Per contributor, what this build read of theirs. */
export interface ContributorRows {
  ownerId: string;
  /** ContentFeature ids, newest first. */
  refs: readonly string[];
}

/**
 * Bring the lineage rows up to date with one build: upsert the contributors it read (consent in force, categories,
 * references), mark everyone else inactive. O(contributors) writes, in small batches.
 */
export async function syncContributions(build: { id: string; builtAt: Date }, read: readonly ContributorRows[], policyVersion: string, categories: readonly string[]): Promise<{ active: number; inactive: number }> {
  const owners = read.map((r) => r.ownerId);
  const consents = owners.length
    ? await db.aiDataConsent.findMany({ where: { userId: { in: owners }, consentType: CONSENT_TYPE, status: "granted" }, orderBy: { createdAt: "desc" }, select: { id: true, userId: true, policyVersion: true } })
    : [];
  const consentOf = new Map<string, { id: string; policyVersion: string }>();
  for (const c of consents) if (!consentOf.has(c.userId)) consentOf.set(c.userId, { id: c.id, policyVersion: c.policyVersion });
  const keys: string[] = [];
  const batch = 25;
  for (let i = 0; i < read.length; i += batch) {
    await Promise.all(
      read.slice(i, i + batch).map((r) => {
        const consent = consentOf.get(r.ownerId);
        if (!consent) return null; // read without a granted row on file: should not happen (the rebuild selects by consent); never record it as a contribution
        const key = contributorKey(r.ownerId);
        keys.push(key);
        const refs = JSON.stringify(r.refs.slice(0, SHARED_CONTRIBUTION_REFS_MAX));
        const common = { consentId: consent.id, policyVersion: consent.policyVersion || policyVersion, categories: JSON.stringify(categories), recordRefs: refs, records: r.refs.length, lastBuildId: build.id, lastContributedAt: build.builtAt, status: "active", inactiveAt: null, deletionStatus: null, deletedAt: null };
        return db.sharedContribution.upsert({
          where: { contributorKey: key },
          create: { contributorKey: key, ...common, firstBuildId: build.id, contributedAt: build.builtAt },
          update: { ...common, builds: { increment: 1 } },
        });
      }),
    );
  }
  const inactive = await db.sharedContribution.updateMany({ where: { status: "active", ...(keys.length ? { contributorKey: { notIn: keys } } : {}) }, data: { status: "inactive", inactiveAt: build.builtAt } });
  return { active: keys.length, inactive: inactive.count };
}

/** A creator asked for their contributed data to be removed: clear the references, keep the pseudonymous row as the record that it was done. */
export async function purgeContributions(userIds: readonly string[], now: Date = new Date()): Promise<number> {
  if (!userIds.length) return 0;
  const r = await db.sharedContribution.updateMany({
    where: { contributorKey: { in: userIds.map(contributorKey) } },
    data: { recordRefs: "[]", records: 0, status: "inactive", inactiveAt: now, deletionStatus: "deleted", deletedAt: now },
  });
  return r.count;
}

/** Build records past retention. Cheap (indexed), so the sweep calls it every tick. */
export async function pruneBuilds(now: Date = new Date()): Promise<number> {
  const r = await db.sharedDatasetBuild.deleteMany({ where: { builtAt: { lt: new Date(now.getTime() - SHARED_BUILD_RETENTION_DAYS * 864e5) } } });
  return r.count;
}

/** What a creator can see of their own lineage: counts and dates, never another creator's anything. */
export async function myContribution(ownerId: string): Promise<{ status: string; records: number; builds: number; since: string; last: string; deleted: boolean } | null> {
  const row = await db.sharedContribution.findUnique({ where: { contributorKey: contributorKey(ownerId) }, select: { status: true, records: true, builds: true, contributedAt: true, lastContributedAt: true, deletionStatus: true } });
  if (!row) return null;
  return { status: row.status, records: row.records, builds: row.builds, since: row.contributedAt.toISOString(), last: row.lastContributedAt.toISOString(), deleted: row.deletionStatus === "deleted" };
}

export interface BuildsSummary {
  latest: { seq: number; datasetVersion: string; builtAt: string; trigger: string; contributors: number; rowsRead: number; rowsKept: number; buckets: number; rejected: SharedRejections; validation: string; anomaly: string | null; served: boolean; durationMs: number } | null;
  recent: { seq: number; datasetVersion: string; builtAt: string; trigger: string; contributors: number; rowsKept: number; buckets: number; validation: string; anomaly: string | null; served: boolean }[];
  total: number;
  flagged30d: number;
  failed30d: number;
  retentionDays: number;
  lineage: { active: number; inactive: number; deleted: number; recordsActive: number };
}

export async function buildsSummary(now: Date = new Date(), recent = 12): Promise<BuildsSummary> {
  const since = new Date(now.getTime() - 30 * 864e5);
  const [rows, total, flagged, failed, active, inactive, deleted, records] = await Promise.all([
    db.sharedDatasetBuild.findMany({ orderBy: { seq: "desc" }, take: recent }),
    db.sharedDatasetBuild.count(),
    db.sharedDatasetBuild.count({ where: { builtAt: { gte: since }, anomaly: { not: null }, validation: "passed" } }),
    db.sharedDatasetBuild.count({ where: { builtAt: { gte: since }, validation: "failed" } }),
    db.sharedContribution.count({ where: { status: "active" } }),
    db.sharedContribution.count({ where: { status: "inactive", deletionStatus: null } }),
    db.sharedContribution.count({ where: { deletionStatus: "deleted" } }),
    db.sharedContribution.aggregate({ where: { status: "active" }, _sum: { records: true } }),
  ]);
  const parseRej = (s: string): SharedRejections => {
    try {
      return JSON.parse(s);
    } catch {
      return { unmeasured: 0, noMetric: 0, thinBuckets: 0, truncated: false };
    }
  };
  const l = rows[0];
  return {
    latest: l ? { seq: l.seq, datasetVersion: l.datasetVersion, builtAt: l.builtAt.toISOString(), trigger: l.trigger, contributors: l.contributors, rowsRead: l.rowsRead, rowsKept: l.rowsKept, buckets: l.buckets, rejected: parseRej(l.rejected), validation: l.validation, anomaly: l.anomaly, served: l.served, durationMs: l.durationMs } : null,
    recent: rows.map((r) => ({ seq: r.seq, datasetVersion: r.datasetVersion, builtAt: r.builtAt.toISOString(), trigger: r.trigger, contributors: r.contributors, rowsKept: r.rowsKept, buckets: r.buckets, validation: r.validation, anomaly: r.anomaly, served: r.served })),
    total,
    flagged30d: flagged,
    failed30d: failed,
    retentionDays: SHARED_BUILD_RETENTION_DAYS,
    lineage: { active, inactive, deleted, recordsActive: records._sum.records ?? 0 },
  };
}
