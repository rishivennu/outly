import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError, json, route } from "@/lib/http";
import { storage } from "@/lib/storage";
import { ALLOWED_EXT, ALLOWED_VIDEO_MIME } from "@/lib/media/probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  name: z.string().min(1).max(200),
  type: z.string().max(100),
  size: z.number().int().positive(),
});

/**
 * Tells the client how to upload: straight to the bucket when the driver allows it (Supabase TUS,
 * or R2/S3 presigned PUT / multipart), else stream through /api/media.
 */
export const GET = route(async () => {
  return json({
    direct: Boolean(storage.createDirectUpload),
    driver: storage.name,
    maxBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
    chunkSize: storage.multipart?.partSize ?? 6 * 1024 * 1024,
  });
});

/**
 * Step 1 of a direct upload. Validates the file up front, reserves a private key under the user's
 * folder and returns a one-time signed upload token for exactly that key. No video bytes touch our server.
 */
export const POST = route(
  async (req, { user }) => {
    if (!storage.createDirectUpload) throw new HttpError(409, "Direct upload isn't available on this storage driver.", "NO_DIRECT");
    const b = body.parse(await req.json());
    const ext = extname(b.name).toLowerCase();
    const max = env.MAX_UPLOAD_MB * 1024 * 1024;
    const mime = b.type || (ext === ".mov" ? "video/quicktime" : "video/mp4");
    if (!(ALLOWED_VIDEO_MIME as readonly string[]).includes(mime) || !(ALLOWED_EXT as readonly string[]).includes(ext))
      throw new HttpError(415, "That one isn't a video we can use yet. Try an MP4 or MOV.");
    if (b.size > max) throw new HttpError(413, `That's a big one. Keep it under ${env.MAX_UPLOAD_MB} MB for now.`, "TOO_LARGE");

    const id = randomUUID();
    const key = `videos/${user.id}/${id}${ext}`;
    const up = await storage.createDirectUpload(key, { size: b.size, contentType: mime });
    const media = await db.media.create({
      data: { userId: user.id, originalFilename: b.name, storageKey: key, mimeType: mime, size: b.size, status: "uploading" },
    });
    const base = { mediaId: media.id, key, mode: up.mode, contentType: mime };
    if (up.mode === "tus")
      return json({ ...base, bucket: env.SUPABASE_BUCKET, token: up.token, uploadUrl: up.url, resumableUrl: up.resumableUrl, chunkSize: 6 * 1024 * 1024 }, { status: 201 });
    if (up.mode === "put") return json({ ...base, uploadUrl: up.url, chunkSize: b.size }, { status: 201 });
    return json({ ...base, uploadId: up.uploadId, partSize: up.partSize, chunkSize: up.partSize, parts: Math.ceil(b.size / up.partSize) }, { status: 201 });
  },
  { limit: [20, 60_000] },
);
