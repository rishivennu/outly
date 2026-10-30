import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { storage } from "./storage";
import { adminEvent } from "./admin/route";
import { CLEANUP_MAX_ATTEMPTS, DELETION_KEEP_DAYS, cleanupDelay, type DeletionView } from "./account-cleanup-core";

export const hashDeletionToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const newDeletionToken = () => randomBytes(32).toString("base64url");

/** Refresh a deletion's counts and settle its status once nothing is left to try. */
async function settleDeletion(id: string) {
  const [total, done, dead] = await Promise.all([
    db.storageCleanup.count({ where: { deletionId: id } }),
    db.storageCleanup.count({ where: { deletionId: id, doneAt: { not: null } } }),
    db.storageCleanup.count({ where: { deletionId: id, doneAt: null, attempts: { gte: CLEANUP_MAX_ATTEMPTS } } }),
  ]);
  const status = done === total ? "done" : done + dead === total ? "failed" : "running";
  const r = await db.accountDeletion.updateMany({
    where: { id, status: "running" },
    data: { filesTotal: total, filesDone: done, status, ...(status !== "running" ? { finishedAt: new Date() } : {}) },
  });
  if (r.count === 1 && status === "failed")
    await adminEvent("account", "File cleanup needs a hand", `${dead} uploaded file${dead === 1 ? "" : "s"} from a deleted account could not be removed after ${CLEANUP_MAX_ATTEMPTS} tries. See StorageCleanup rows with doneAt empty.`).catch(() => {});
}

/**
 * Remove due objects (bounded, so the sweeper stays quick). Each row is claimed by bumping its attempt
 * count and pushing nextAt out BEFORE the bucket is called, so two sweeps running at once never both try
 * it, and a crash mid-call simply means the row comes round again later. Removing a missing object succeeds.
 */
export async function runCleanups(opts: { deletionId?: string; limit?: number; budgetMs?: number; now?: Date } = {}) {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const rows = await db.storageCleanup.findMany({
    where: { doneAt: null, attempts: { lt: CLEANUP_MAX_ATTEMPTS }, nextAt: { lte: now }, ...(opts.deletionId ? { deletionId: opts.deletionId } : {}) },
    orderBy: { nextAt: "asc" },
    take: opts.limit ?? 25,
  });
  let removed = 0;
  let failed = 0;
  const touched = new Set<string>();
  for (const row of rows) {
    if (opts.budgetMs && Date.now() - started > opts.budgetMs) break;
    const attempts = row.attempts + 1;
    const claim = await db.storageCleanup.updateMany({
      where: { id: row.id, attempts: row.attempts, doneAt: null },
      data: { attempts, nextAt: new Date(now.getTime() + cleanupDelay(attempts)) },
    });
    if (claim.count !== 1) continue;
    try {
      await storage.remove(row.key);
      await db.storageCleanup.update({ where: { id: row.id }, data: { doneAt: new Date(), lastError: null } });
      removed++;
    } catch (e) {
      failed++;
      await db.storageCleanup.update({ where: { id: row.id }, data: { lastError: String((e as Error)?.message ?? e).slice(0, 300) } }).catch(() => {});
    }
    if (row.deletionId) touched.add(row.deletionId);
  }
  for (const id of touched) await settleDeletion(id).catch((e) => console.error("[cleanup] settle", id, e));
  return { removed, failed };
}

/** The status link: looked up by the token's hash only, so the database never holds anything that opens it. */
export async function deletionStatus(token: string): Promise<DeletionView | null> {
  if (!token || token.length > 100) return null;
  const d = await db.accountDeletion.findUnique({ where: { tokenHash: hashDeletionToken(token) } });
  if (!d) return null;
  return { status: d.status as DeletionView["status"], filesTotal: d.filesTotal, filesDone: d.filesDone, startedAt: d.createdAt.toISOString(), finishedAt: d.finishedAt?.toISOString() ?? null };
}

/** Finished status records and their file rows, after DELETION_KEEP_DAYS. Failed ones stay until staff clear them. */
export async function pruneDeletions(now: Date = new Date()) {
  const r = await db.accountDeletion.deleteMany({ where: { status: "done", finishedAt: { lt: new Date(now.getTime() - DELETION_KEEP_DAYS * 864e5) } } });
  return r.count;
}
