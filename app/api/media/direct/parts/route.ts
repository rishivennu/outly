import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { storage } from "@/lib/storage";
import { ownedMedia } from "@/lib/services";
import { legacyPartSize, recordParts, sessionClosed } from "@/lib/media/upload-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const part = z.object({ n: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(200), size: z.number().int().positive() });
const body = z.object({
  mediaId: z.string().min(1),
  uploadId: z.string().min(1).max(1024),
  /** part numbers to presign (at most 24 per call) */
  parts: z.array(z.number().int().min(1).max(10_000)).max(24).default([]),
  /** also return the parts the bucket already has (used when resuming) */
  list: z.boolean().optional(),
  /** R1193: parts that landed since the last call, with the ETag the bucket answered (recorded, never trusted for the stitch) */
  done: z.array(part).max(48).default([]),
  /** R1193: the browser's identity check for the file; a resume with a different file is refused */
  fingerprint: z.string().max(300).optional(),
});

const expired = () => new HttpError(410, "That upload expired. Drop the video again and we'll start fresh.", "EXPIRED");

/**
 * R2/S3 multipart, step 2: presigned PUT URLs for the next few parts of the caller's own upload.
 * Each URL is pinned to that part's exact byte size, so the declared file size is the hard ceiling.
 * R1193: the links last UPLOAD_URL_TTL_SEC (15 minutes by default) and the browser asks again when one runs out.
 * The part size comes from the upload's own session, so changing UPLOAD_PART_MB never breaks an upload on its way.
 */
export const POST = route(
  async (req, { user }) => {
    const mp = storage.multipart;
    if (!mp) throw new HttpError(409, "Multipart upload isn't available on this storage driver.", "NO_MULTIPART");
    const b = body.parse(await req.json());
    const m = await ownedMedia(user.id, b.mediaId);
    if (m.status !== "uploading") throw new HttpError(409, "That upload is already finished.", "NOT_UPLOADING");
    const s = await db.uploadSession.findUnique({ where: { mediaId: m.id } });
    if (s) {
      if (s.userId !== user.id || s.uploadId !== b.uploadId) throw new HttpError(409, "That upload doesn't match this video. Drop it again to start fresh.", "UPLOAD_MISMATCH");
      if (sessionClosed(s)) throw expired();
      if (b.fingerprint && s.fingerprint && b.fingerprint !== s.fingerprint)
        throw new HttpError(409, "This isn't the same file that started uploading. Drop the video again to start fresh.", "FILE_CHANGED");
    }
    let uploaded: { n: number; size: number }[] | undefined;
    // An upload started before R1193 has no session, so the bucket is asked what it holds every time:
    // part 1 gives the size it was cut with (see legacyPartSize). Each part link is pinned to its exact size.
    if (b.list || !s) {
      try {
        const have = await mp.list(m.storageKey, b.uploadId);
        uploaded = have.map((p) => ({ n: p.n, size: p.size }));
        // The bucket's list is the truth: bring the session's record in line with it.
        if (s) await recordParts(s, have.map((p) => ({ n: p.n, etag: p.etag, size: p.size })));
      } catch (e) {
        if ((e as { code?: string }).code === "NoSuchUpload") throw expired();
        throw e;
      }
    } else if (b.done.length) await recordParts(s, b.done);
    const partSize = s?.chunkSize ?? legacyPartSize(uploaded, m.size);
    const total = s?.totalParts ?? Math.ceil(m.size / partSize);
    const wanted = [...new Set(b.parts)].filter((n) => n <= total);
    if (!b.list) uploaded = undefined;
    const urls = await mp.sign(m.storageKey, b.uploadId, m.size, wanted, partSize);
    return json({ urls, uploaded, partSize, total, ttl: mp.urlTtlSec });
  },
  { limit: [120, 60_000] },
);
