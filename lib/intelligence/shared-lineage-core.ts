import { SHARED_MAX_OWNER_SHARE, SHARED_MIN_OWNERS, SHARED_MIN_POSTS, type SharedBaselines, type SharedBucket } from "./shared-core";

/**
 * R1336: the shared pipeline's bookkeeping, pure. What a build rejected and why, whether the document it produced is
 * safe to serve (no contributor id inside, every bucket past its floors), how it compares with the build before, and
 * when an admin should look. Nothing here names a creator; the server half (shared-lineage.ts) stores it.
 *
 * Promotion is automatic unless validation fails. The consent promise ("your posts leave at the next rebuild") outranks
 * a manual gate: holding a build would keep serving a withdrawn creator's medians. So an odd-looking build is served
 * AND flagged (AdminEvent + `anomaly`), and the admin's approval control is the existing retire / restore on the document.
 */

/** Build records older than this are pruned by the sweep. Lineage rows (one per contributor) are kept current, not pruned. */
export const SHARED_BUILD_RETENTION_DAYS = 90;
/** Fewer than this share of the previous build's buckets or rows is an anomaly. */
export const SHARED_ANOMALY_DROP = 0.5;
/** A common bucket whose views-per-follower median moved more than this (percent) is an anomaly. */
export const SHARED_ANOMALY_SHIFT_PCT = 50;
/** ContentFeature ids kept per contributor in the lineage row (newest first). */
export const SHARED_CONTRIBUTION_REFS_MAX = 60;

export const datasetVersion = (seq: number) => `sd-${seq}`;

export interface SharedRejections {
  /** Rows whose PerfFeatures were missing or not yet measured. */
  unmeasured: number;
  /** Measured rows with no usable metric (no views, views per follower or engagement rate) or outside the window. */
  noMetric: number;
  /** Buckets that existed but were too thin or too concentrated to publish (`SharedBaselines.dropped`). */
  thinBuckets: number;
  /** The reader hit its row cap, so the window was not read in full. */
  truncated: boolean;
}

export interface SharedEvaluation {
  previous: { seq: number | null; buckets: number; rows: number; owners: number } | null;
  buckets: number;
  rows: number;
  owners: number;
  /** Buckets present in both documents. */
  common: number;
  /** Largest absolute percent move of a common bucket's views-per-follower median, null when none is comparable. */
  maxMedianShiftPct: number | null;
  anomaly: string | null;
}

const pctMove = (a: number, b: number): number | null => (a > 0 ? Math.abs((b - a) / a) * 100 : b > 0 ? 100 : null);

/** Compare a fresh document with the one it replaces. `prevSeq` is the previous build's number when known. */
export function compareShared(prev: SharedBaselines | null, next: SharedBaselines, prevSeq: number | null = null): SharedEvaluation {
  if (!prev) return { previous: null, buckets: next.buckets.length, rows: next.rows, owners: next.owners, common: 0, maxMedianShiftPct: null, anomaly: null };
  const before = new Map(prev.buckets.map((b) => [b.key, b]));
  let common = 0;
  let maxShift: number | null = null;
  for (const b of next.buckets) {
    const p = before.get(b.key);
    if (!p) continue;
    common++;
    if (p.viewsPerFollower && b.viewsPerFollower) {
      const m = pctMove(p.viewsPerFollower.median, b.viewsPerFollower.median);
      if (m !== null && (maxShift === null || m > maxShift)) maxShift = Math.round(m * 10) / 10;
    }
  }
  const reasons: string[] = [];
  if (prev.buckets.length > 0 && next.buckets.length < prev.buckets.length * SHARED_ANOMALY_DROP) reasons.push(`fewer than half the buckets of the build before (${next.buckets.length} vs ${prev.buckets.length})`);
  if (prev.rows > 0 && next.rows < prev.rows * SHARED_ANOMALY_DROP) reasons.push(`fewer than half the rows of the build before (${next.rows} vs ${prev.rows})`);
  if (maxShift !== null && maxShift > SHARED_ANOMALY_SHIFT_PCT) reasons.push(`a bucket's views-per-follower median moved ${maxShift}%`);
  return {
    previous: { seq: prevSeq, buckets: prev.buckets.length, rows: prev.rows, owners: prev.owners },
    buckets: next.buckets.length,
    rows: next.rows,
    owners: next.owners,
    common,
    maxMedianShiftPct: maxShift,
    anomaly: reasons.length ? reasons.join("; ") : null,
  };
}

/**
 * Is this document safe to serve? No contributor id (or any id-looking string we were given) may appear in it, every
 * published bucket must clear the floors, and the shape must be the one readers parse. A failed check holds the
 * document back: the server stores an empty one in its place and tells the admins.
 */
export function validateShared(doc: SharedBaselines, contributorIds: readonly string[]): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  const json = JSON.stringify(doc);
  let leaked = 0;
  for (const id of contributorIds) if (id && json.includes(id)) leaked++;
  if (leaked) notes.push(`${leaked} contributor id${leaked === 1 ? "" : "s"} found in the document`);
  if (!Number.isFinite(new Date(doc.builtAt).getTime())) notes.push("builtAt is not a date");
  const thin = doc.buckets.filter((b: SharedBucket) => b.owners < SHARED_MIN_OWNERS || b.n < SHARED_MIN_POSTS || b.topOwnerShare > SHARED_MAX_OWNER_SHARE);
  if (thin.length) notes.push(`${thin.length} bucket${thin.length === 1 ? "" : "s"} below the publishing floors`);
  const stats = doc.buckets.flatMap((b) => [b.views, b.viewsPerFollower, b.engagementRate]).filter((s): s is NonNullable<typeof s> => !!s);
  const bad = stats.filter((s) => s.owners < SHARED_MIN_OWNERS || s.n < SHARED_MIN_POSTS || !Number.isFinite(s.median));
  if (bad.length) notes.push(`${bad.length} statistic${bad.length === 1 ? "" : "s"} below the publishing floors`);
  return { ok: notes.length === 0, notes };
}

/** The one-line summary of a build for the admin table and the sweep log. */
export function buildLine(b: { seq: number; contributors: number; rowsKept: number; buckets: number; validation: string; served: boolean; anomaly: string | null }): string {
  const head = `${datasetVersion(b.seq)}: ${b.buckets} buckets from ${b.contributors} creators' ${b.rowsKept} posts`;
  if (b.validation !== "passed") return `${head}; validation failed, not served`;
  return b.anomaly ? `${head}; served, flagged: ${b.anomaly}` : `${head}; served`;
}
