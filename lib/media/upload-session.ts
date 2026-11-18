import { db } from "@/lib/db";
import { partBytes } from "@/lib/storage/s3x";

/**
 * R1193: the server half of a resumable R2/S3 multipart upload. Every multipart upload gets an UploadSession row
 * holding the bucket's upload id and the part size it was cut with, plus an UploadPart row for each part the browser
 * reports as landed. The bucket's own part list stays the truth when the parts are stitched; these rows let a resume,
 * Cancel and the sweeper find the upload, and they are what "12 of 63 parts" is counted from.
 */

/** A session lives as long as the sweeper's stale window (STALE_DIRECT_UPLOAD_MS), so a slow resumed upload can finish. */
export const SESSION_TTL_MS = 24 * 3600_000;
/** A completion that has not finished in this long crashed or timed out; the next /complete may take it over. */
export const FINALIZE_STALE_MS = 2 * 60_000;

/**
 * Uploads started before R1193 have no session, and the part size they were cut with was never saved. Before R1193
 * it was UPLOAD_PART_MB, 10 MiB by default. Part 1 in the bucket tells us for sure once it is there (it is the full
 * part size whenever the file needs more than one part); until then the old default is the best guess.
 */
export const LEGACY_PART_BYTES = 10 * 1024 * 1024;
export function legacyPartSize(listed: { n: number; size: number }[] | null | undefined, fileSize: number) {
  const first = listed?.find((p) => p.n === 1);
  return first && first.size < fileSize ? first.size : LEGACY_PART_BYTES;
}

export type ReportedPart = { n: number; etag: string; size: number };
type SessionLike = { id: string; fileSize: number; chunkSize: number; totalParts: number };

/** S3 and R2 answer with a quoted hex MD5 or a similar opaque token. Anything else is not from the bucket. */
const ETAG = /^"?[A-Za-z0-9._:-]{1,128}"?$/;

/** Parts the browser says it finished, kept only when the number and the byte size match this upload's own split. */
export function validParts(s: SessionLike, parts: ReportedPart[]): ReportedPart[] {
  const seen = new Set<number>();
  const out: ReportedPart[] = [];
  for (const p of parts) {
    if (p.n < 1 || p.n > s.totalParts || seen.has(p.n)) continue;
    if (p.size !== partBytes(s.fileSize, s.chunkSize, p.n) || !ETAG.test(p.etag)) continue;
    seen.add(p.n);
    out.push(p);
  }
  return out;
}

/** Records landed parts (a re-sent part replaces its row) and refreshes the session's count. Returns that count. */
export async function recordParts(s: SessionLike, parts: ReportedPart[]): Promise<number> {
  const ok = validParts(s, parts);
  for (const p of ok) {
    await db.uploadPart
      .upsert({
        where: { sessionId_partNumber: { sessionId: s.id, partNumber: p.n } },
        create: { sessionId: s.id, partNumber: p.n, etag: p.etag, size: p.size },
        update: { etag: p.etag, size: p.size },
      })
      // Two reports of the same part racing: the other one wrote it, which is all we need.
      .catch((e: { code?: string }) => {
        if (e?.code !== "P2002") throw e;
      });
  }
  const done = await db.uploadPart.count({ where: { sessionId: s.id } });
  await db.uploadSession.update({ where: { id: s.id }, data: { completedParts: done } });
  return done;
}

/**
 * Duplicate-completion guard: only one /complete at a time may stitch a session. Moves it from "uploading" to
 * "finalizing" in one conditional write; a "finalizing" left behind by a crashed request is taken over after a while.
 */
export async function claimFinalize(id: string, now = Date.now()): Promise<boolean> {
  const r = await db.uploadSession.updateMany({
    where: { id, OR: [{ status: "uploading" }, { status: "finalizing", updatedAt: { lt: new Date(now - FINALIZE_STALE_MS) } }] },
    data: { status: "finalizing" },
  });
  return r.count === 1;
}

/** Puts a session back to "uploading" (parts still missing, or the bucket was briefly away), so the browser can finish. */
export const releaseFinalize = (id: string) => db.uploadSession.updateMany({ where: { id, status: "finalizing" }, data: { status: "uploading" } });

/** True when the row says the file must not be used: aborted, failed or past its window. */
export const sessionClosed = (s: { status: string; expiresAt: Date }, now = Date.now()) => s.status === "aborted" || s.status === "failed" || s.expiresAt.getTime() <= now;
