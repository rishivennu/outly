import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError, json, route } from "@/lib/http";
import { storage } from "@/lib/storage";
import { ALLOWED_EXT, ALLOWED_VIDEO_MIME } from "@/lib/media/probe";
import { uploadLimitBytes } from "@/lib/billing/entitlements";
import { legacyMeter, reserveUpload, sizeColumns, storageUsageFor } from "@/lib/storage/quota";
import { SESSION_TTL_MS } from "@/lib/media/upload-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  name: z.string().min(1).max(200),
  type: z.string().max(100),
  size: z.number().int().positive(),
  /** R1193: the browser's identity check for the file, compared again before a resume. */
  fingerprint: z.string().max(300).optional(),
});

/**
 * Tells the client how to upload: straight to the bucket when the driver allows it (Supabase TUS,
 * or R2/S3 presigned PUT / multipart), else stream through /api/media. Also the formats and size this
 * account may upload, shown before a file is picked.
 */
export const GET = route(async (_req, { user }) => {
  const [lim, usage] = await Promise.all([uploadLimitBytes(user.id), storageUsageFor(user.id)]);
  const st = legacyMeter(usage);
  return json({
    // R1209: the limit that binds (the monthly allowance on Free, kept storage on paid plans); `quota` has both.
    storage: { usedBytes: st.usedBytes, limitBytes: st.limitBytes, remainingBytes: st.remainingBytes, over: st.over, label: st.label, kind: st.kind },
    quota: usage,
    direct: Boolean(storage.createDirectUpload),
    maxBytes: lim.bytes,
    maxMb: lim.mb,
    planLimited: lim.planLimited,
    planName: lim.planName,
    chunkSize: storage.multipart?.partSize ?? 6 * 1024 * 1024,
    // The same lists POST checks, so the picker can say up front what will be taken.
    formats: { extensions: [...ALLOWED_EXT], mimeTypes: [...ALLOWED_VIDEO_MIME], label: "MP4 or MOV" },
  });
});

/**
 * Step 1 of a direct upload. Validates the file up front, reserves a private key under the user's
 * folder and returns a one-time signed upload token for exactly that key. No video bytes touch our server.
 * R1193: a multipart upload also gets an UploadSession (upload id, part size, expiry), so it can be resumed,
 * cancelled and swept, and its links are short-lived and signed again on request.
 */
export const POST = route(
  async (req, { user }) => {
    if (!storage.createDirectUpload) throw new HttpError(409, "Direct upload isn't available on this storage driver.", "NO_DIRECT");
    const b = body.parse(await req.json());
    const ext = extname(b.name).toLowerCase();
    const mime = b.type || (ext === ".mov" ? "video/quicktime" : "video/mp4");
    if (!(ALLOWED_VIDEO_MIME as readonly string[]).includes(mime) || !(ALLOWED_EXT as readonly string[]).includes(ext))
      throw new HttpError(415, "That one isn't a video we can use yet. Try an MP4 or MOV.");
    const id = randomUUID();
    const key = `videos/${user.id}/${id}${ext}`;
    // R1209: per-file cap, monthly allowance and storage are checked and the "uploading" row that holds this size
    // is made in one locked step, so two uploads started together can't both take the last room. The row holds the
    // space until the upload lands, is cancelled or is swept.
    const media = await reserveUpload(user.id, b.size, (tx) =>
      tx.media.create({ data: { userId: user.id, originalFilename: b.name, storageKey: key, mimeType: mime, ...sizeColumns(b.size), status: "uploading" } }),
    );
    let up: Awaited<ReturnType<NonNullable<typeof storage.createDirectUpload>>>;
    try {
      up = await storage.createDirectUpload(key, { size: b.size, contentType: mime });
    } catch (e) {
      await db.media.updateMany({ where: { id: media.id, status: "uploading" }, data: { status: "failed" } });
      throw e;
    }
    const base = { mediaId: media.id, key, mode: up.mode, contentType: mime };
    if (up.mode === "tus")
      return json({ ...base, bucket: env.SUPABASE_BUCKET, token: up.token, uploadUrl: up.url, resumableUrl: up.resumableUrl, chunkSize: 6 * 1024 * 1024 }, { status: 201 });
    const ttl = storage.multipart?.urlTtlSec;
    if (up.mode === "put") return json({ ...base, uploadUrl: up.url, chunkSize: b.size, ttl }, { status: 201 });
    const parts = Math.ceil(b.size / up.partSize);
    const session = await db.uploadSession.create({
      data: {
        userId: user.id,
        mediaId: media.id,
        objectKey: key,
        uploadId: up.uploadId,
        originalFilename: b.name,
        fileSize: b.size,
        contentType: mime,
        chunkSize: up.partSize,
        totalParts: parts,
        fingerprint: b.fingerprint ?? null,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return json(
      { ...base, uploadId: up.uploadId, partSize: up.partSize, chunkSize: up.partSize, parts, sessionId: session.id, expiresAt: session.expiresAt.getTime(), ttl },
      { status: 201 },
    );
  },
  { limit: [20, 60_000] },
);
