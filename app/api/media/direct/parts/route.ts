import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { storage } from "@/lib/storage";
import { ownedMedia } from "@/lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  mediaId: z.string().min(1),
  uploadId: z.string().min(1).max(1024),
  /** part numbers to presign (at most 24 per call) */
  parts: z.array(z.number().int().min(1).max(10_000)).max(24).default([]),
  /** also return the parts the bucket already has (used when resuming) */
  list: z.boolean().optional(),
});

/**
 * R2/S3 multipart, step 2: presigned PUT URLs for the next few parts of the caller's own upload.
 * Each URL is pinned to that part's exact byte size, so the declared file size is the hard ceiling.
 */
export const POST = route(
  async (req, { user }) => {
    const mp = storage.multipart;
    if (!mp) throw new HttpError(409, "Multipart upload isn't available on this storage driver.", "NO_MULTIPART");
    const b = body.parse(await req.json());
    const m = await ownedMedia(user.id, b.mediaId);
    if (m.status !== "uploading") throw new HttpError(409, "That upload is already finished.", "NOT_UPLOADING");
    const total = Math.ceil(m.size / mp.partSize);
    const wanted = [...new Set(b.parts)].filter((n) => n <= total);
    const urls = await mp.sign(m.storageKey, b.uploadId, m.size, wanted);
    let uploaded: { n: number; size: number }[] | undefined;
    if (b.list) {
      try {
        uploaded = (await mp.list(m.storageKey, b.uploadId)).map((p) => ({ n: p.n, size: p.size }));
      } catch (e) {
        if ((e as { code?: string }).code === "NoSuchUpload") throw new HttpError(410, "That upload expired. Drop the video again and we'll start fresh.", "EXPIRED");
        throw e;
      }
    }
    return json({ urls, uploaded, partSize: mp.partSize, total });
  },
  { limit: [120, 60_000] },
);
