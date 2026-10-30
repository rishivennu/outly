/**
 * File cleanup after an account is deleted (1053), the pure rules. The database rows go in one transaction;
 * the uploaded objects (videos, thumbnails) are removed after, one durable StorageCleanup row each, retried
 * by the minute sweeper with backoff until the bucket confirms they're gone.
 */
export const CLEANUP_MAX_ATTEMPTS = 8;
/** Wait before try n+1: 1 min, 5 min, 30 min, 2 h, then every 12 h. About 2.5 days end to end. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 12 * 3600_000];
export function cleanupDelay(attempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]!;
}
/** Status records are only for the person's status link; they go 30 days after finishing. */
export const DELETION_KEEP_DAYS = 30;

/** Unique, non-empty object keys: a thumbnail shared by two rows is removed once. */
export function cleanupKeys(media: { storageKey: string | null; thumbnailKey: string | null }[]): string[] {
  return [...new Set(media.flatMap((m) => [m.storageKey, m.thumbnailKey]).filter((k): k is string => !!k && k.trim() !== ""))];
}

export type DeletionView = { status: "running" | "done" | "failed"; filesTotal: number; filesDone: number; startedAt: string; finishedAt: string | null };
/** What the status page says, in words. Never claims done before every object is confirmed gone. */
export function deletionMessage(v: DeletionView): string {
  if (v.status === "done" || (v.filesTotal === 0 && v.status !== "failed")) return "Everything is deleted, including your uploaded videos and thumbnails.";
  if (v.status === "failed") return `Your account and data are deleted. ${v.filesTotal - v.filesDone} uploaded file${v.filesTotal - v.filesDone === 1 ? "" : "s"} kept failing to delete, so our team has been alerted to remove ${v.filesTotal - v.filesDone === 1 ? "it" : "them"} by hand.`;
  return `Your account and data are deleted. Removing your uploaded files: ${v.filesDone} of ${v.filesTotal} done. This keeps going even if you close this page.`;
}
