import "server-only";
import { db } from "../db";
import { logLearning } from "./learning";
import {
  CONSENT_CATEGORIES,
  CONSENT_POLICY_VERSION,
  CONSENT_TYPE,
  consentState,
  type ConsentCategory,
  type ConsentRow,
  type ConsentSource,
  type ConsentState,
} from "./consent-core";

/**
 * R1335: the "Help improve Outlly AI" consent record (AiDataConsent), server half. Append-only: every decision is a new
 * row and the newest row is the current state, so the table is its own audit trail. `User.shareLearning` mirrors the
 * current state and is written here only, inside the same transaction, so the bulk readers (rebuild, admin counts) can
 * prefilter on one indexed column while the table stays the source of truth (`consentedOwnerIds` re-checks it).
 *
 * Nothing here looks at the plan. A Free creator's yes feeds the shared model exactly like a paid creator's; a paid
 * creator's no keeps every personal feature. Consent checks live in the pipeline (shared.ts, profile.ts), never in a
 * client flag.
 */

const select = {
  id: true,
  status: true,
  policyVersion: true,
  categories: true,
  source: true,
  consentedAt: true,
  withdrawnAt: true,
  deletionRequestedAt: true,
  deletionStatus: true,
  deletionDoneAt: true,
  createdAt: true,
} as const;

/** All decisions on file for this user, newest first (the audit view and the state fold). */
export async function consentHistory(userId: string, take = 20): Promise<ConsentRow[]> {
  return db.aiDataConsent.findMany({ where: { userId, consentType: CONSENT_TYPE }, orderBy: { createdAt: "desc" }, take, select });
}

export async function currentConsent(userId: string): Promise<ConsentState> {
  return consentState(await consentHistory(userId));
}

/** Does this user's newest decision say yes? (Independent of the plan; independent of the policy version.) */
export async function hasSharedConsent(userId: string): Promise<boolean> {
  const latest = await db.aiDataConsent.findFirst({ where: { userId, consentType: CONSENT_TYPE }, orderBy: { createdAt: "desc" }, select: { status: true } });
  return latest?.status === "granted";
}

/**
 * Owners whose posts may enter the shared pipeline: the mirror column prefilters, the consent table decides. A stale
 * mirror (a row that says true with no granted decision behind it) is ignored and reported so the admin page can show it.
 */
export async function consentedOwnerIds(): Promise<{ ids: string[]; staleMirrors: number }> {
  const mirrored = await db.user.findMany({ where: { shareLearning: true }, select: { id: true } });
  if (!mirrored.length) return { ids: [], staleMirrors: 0 };
  const rows = await db.aiDataConsent.findMany({
    where: { userId: { in: mirrored.map((m) => m.id) }, consentType: CONSENT_TYPE },
    orderBy: { createdAt: "desc" },
    select: { userId: true, status: true },
  });
  const latest = new Map<string, string>();
  for (const r of rows) if (!latest.has(r.userId)) latest.set(r.userId, r.status);
  const ids = mirrored.map((m) => m.id).filter((id) => latest.get(id) === "granted");
  return { ids, staleMirrors: mirrored.length - ids.length };
}

export interface DecisionOpts {
  source: ConsentSource;
  /** Defaults to every category the pipeline reads; a subset is honoured by the pipeline through `categoriesFor`. */
  categories?: readonly ConsentCategory[];
  now?: Date;
}

/**
 * Say yes. Idempotent: already granted under the current policy version returns the state unchanged (no new row). A
 * grant under an older version writes a fresh row (the re-confirmation the UI asked for).
 */
export async function grantConsent(userId: string, opts: DecisionOpts): Promise<ConsentState> {
  const now = opts.now ?? new Date();
  const before = await currentConsent(userId);
  if (before.granted && before.current && !before.deletion) return before;
  const categories = [...(opts.categories?.length ? opts.categories : CONSENT_CATEGORIES)];
  await db.$transaction(async (tx) => {
    await tx.aiDataConsent.create({
      data: { userId, consentType: CONSENT_TYPE, status: "granted", policyVersion: CONSENT_POLICY_VERSION, categories: JSON.stringify(categories), source: opts.source, consentedAt: now },
    });
    // A new yes after a deletion request closes that request: there is nothing of theirs to remove any more and they want back in.
    await tx.aiDataConsent.updateMany({ where: { userId, consentType: CONSENT_TYPE, deletionStatus: "requested" }, data: { deletionStatus: "done", deletionDoneAt: now } });
    await tx.user.update({ where: { id: userId }, data: { shareLearning: true } });
  });
  await logLearning(userId, "consent_granted", { data: { policyVersion: CONSENT_POLICY_VERSION, categories, source: opts.source }, at: now }).catch(() => false);
  return currentConsent(userId);
}

/** Say no. Idempotent: not granted returns the state unchanged. Takes effect in the pipeline at the next rebuild. */
export async function withdrawConsent(userId: string, opts: Pick<DecisionOpts, "source" | "now">): Promise<ConsentState> {
  const now = opts.now ?? new Date();
  const before = await currentConsent(userId);
  if (!before.granted) return before;
  await db.$transaction(async (tx) => {
    await tx.aiDataConsent.create({
      data: { userId, consentType: CONSENT_TYPE, status: "withdrawn", policyVersion: before.policyVersion ?? CONSENT_POLICY_VERSION, categories: "[]", source: opts.source, consentedAt: before.consentedAt ? new Date(before.consentedAt) : null, withdrawnAt: now },
    });
    await tx.user.update({ where: { id: userId }, data: { shareLearning: false } });
  });
  await logLearning(userId, "consent_withdrawn", { data: { source: opts.source }, at: now }).catch(() => false);
  return currentConsent(userId);
}

/**
 * Ask for contributed data to be removed. Withdraws first if needed, then marks the request on the newest row. The
 * shared sweep rebuilds at its next tick (not the hourly timer) and marks the request done; R1336 also purges the
 * contribution rows that say which posts were used. Idempotent while a request is open.
 */
export async function requestDeletion(userId: string, opts: Pick<DecisionOpts, "source" | "now">): Promise<ConsentState> {
  const now = opts.now ?? new Date();
  let state = await currentConsent(userId);
  if (state.deletion?.status === "requested") return state;
  if (state.granted) state = await withdrawConsent(userId, opts);
  const latest = await db.aiDataConsent.findFirst({ where: { userId, consentType: CONSENT_TYPE }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (latest) {
    await db.aiDataConsent.update({ where: { id: latest.id }, data: { deletionRequestedAt: now, deletionStatus: "requested", deletionDoneAt: null } });
  } else {
    // Never consented, nothing was ever used: record the request anyway (it is theirs to make) and close it at once.
    await db.aiDataConsent.create({
      data: { userId, consentType: CONSENT_TYPE, status: "withdrawn", policyVersion: CONSENT_POLICY_VERSION, categories: "[]", source: opts.source, withdrawnAt: now, deletionRequestedAt: now, deletionStatus: "done", deletionDoneAt: now },
    });
  }
  await logLearning(userId, "consent_deletion_requested", { data: { source: opts.source }, at: now }).catch(() => false);
  return currentConsent(userId);
}

/** Open deletion requests, oldest first: the shared sweep rebuilds for them and then calls `closeDeletions`. */
export async function pendingDeletions(): Promise<{ id: string; userId: string; requestedAt: Date }[]> {
  const rows = await db.aiDataConsent.findMany({ where: { consentType: CONSENT_TYPE, deletionStatus: "requested" }, orderBy: { deletionRequestedAt: "asc" }, select: { id: true, userId: true, deletionRequestedAt: true } });
  return rows.map((r) => ({ id: r.id, userId: r.userId, requestedAt: r.deletionRequestedAt ?? new Date(0) }));
}

export async function closeDeletions(ids: readonly string[], now: Date = new Date()): Promise<number> {
  if (!ids.length) return 0;
  const r = await db.aiDataConsent.updateMany({ where: { id: { in: [...ids] }, deletionStatus: "requested" }, data: { deletionStatus: "done", deletionDoneAt: now } });
  return r.count;
}

/** Aggregates for the admin page (R1337 shows them): counts only, never a name. */
export interface ConsentSummary {
  granted: number;
  withdrawn: number;
  neverAsked: number;
  deletionsOpen: number;
  deletionsDone: number;
  staleMirrors: number;
  byPolicyVersion: Record<string, number>;
  byCategory: Record<string, number>;
  decisions30d: { granted: number; withdrawn: number };
}

export async function consentSummary(now: Date = new Date()): Promise<ConsentSummary> {
  const [rows, creators, open, done, mirrors] = await Promise.all([
    db.aiDataConsent.findMany({ where: { consentType: CONSENT_TYPE }, orderBy: { createdAt: "desc" }, select: { userId: true, status: true, policyVersion: true, categories: true, createdAt: true } }),
    db.user.count(),
    db.aiDataConsent.count({ where: { consentType: CONSENT_TYPE, deletionStatus: "requested" } }),
    db.aiDataConsent.count({ where: { consentType: CONSENT_TYPE, deletionStatus: "done" } }),
    consentedOwnerIds(),
  ]);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.userId)) latest.set(r.userId, r);
  const byPolicyVersion: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let granted = 0;
  let withdrawn = 0;
  for (const r of latest.values()) {
    if (r.status === "granted") {
      granted++;
      byPolicyVersion[r.policyVersion] = (byPolicyVersion[r.policyVersion] ?? 0) + 1;
      for (const c of JSON.parse(r.categories || "[]") as string[]) byCategory[c] = (byCategory[c] ?? 0) + 1;
    } else withdrawn++;
  }
  const since = now.getTime() - 30 * 864e5;
  const recent = rows.filter((r) => new Date(r.createdAt).getTime() >= since);
  return {
    granted,
    withdrawn,
    neverAsked: Math.max(0, creators - latest.size),
    deletionsOpen: open,
    deletionsDone: done,
    staleMirrors: mirrors.staleMirrors,
    byPolicyVersion,
    byCategory,
    decisions30d: { granted: recent.filter((r) => r.status === "granted").length, withdrawn: recent.filter((r) => r.status === "withdrawn").length },
  };
}
