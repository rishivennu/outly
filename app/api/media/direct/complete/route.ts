import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { storage } from "@/lib/storage";
import { looksLikeIsoBmff } from "@/lib/media/probe";
import { enqueue } from "@/lib/queue";
import { mediaView, ownedMedia } from "@/lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ mediaId: z.string().min(1), uploadId: z.string().min(1).max(1024).optional() });

/** Step 2: the browser says it's done. We verify the object really landed, is the declared size and is an MP4/MOV. */
export const POST = route(async (req, { user }) => {
  const { mediaId, uploadId } = body.parse(await req.json());
  const m = await ownedMedia(user.id, mediaId);
  if (m.status !== "uploading") return json({ media: await mediaView(m) }); // idempotent
  const mp = storage.multipart;
  if (uploadId && mp) {
    // R2/S3 multipart: stitch the parts the bucket actually holds, after checking they cover the file.
    let parts;
    try {
      parts = await mp.list(m.storageKey, uploadId);
    } catch (e) {
      // NoSuchUpload after a successful complete (a retried request) is fine: the object is there.
      if ((e as { code?: string }).code !== "NoSuchUpload") throw e;
      parts = null;
    }
    if (parts) {
      const total = Math.ceil(m.size / mp.partSize);
      const sum = parts.reduce((a, p) => a + p.size, 0);
      if (parts.length !== total || parts.some((p, i) => p.n !== i + 1) || sum !== m.size)
        throw new HttpError(409, "Some of the video is still missing. Let's finish that upload.", "PARTS_MISSING");
      await mp.complete(m.storageKey, uploadId, parts);
    }
  }
  const st = await storage.stat(m.storageKey);
  if (!st) throw new HttpError(409, "We didn't receive the video yet. Let's try that upload again.", "NOT_UPLOADED");
  if (Math.abs(st.size - m.size) > 0) {
    await storage.remove(m.storageKey).catch(() => {});
    await db.media.update({ where: { id: m.id }, data: { status: "failed" } });
    throw new HttpError(422, "The upload arrived incomplete. Let's try again.", "SIZE_MISMATCH");
  }
  const { stream } = await storage.read(m.storageKey, { start: 0, end: 31 });
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  if (!looksLikeIsoBmff(Buffer.concat(chunks))) {
    await storage.remove(m.storageKey).catch(() => {});
    await db.media.update({ where: { id: m.id }, data: { status: "failed" } });
    throw new HttpError(415, "That file says it's a video, but it doesn't look like one.", "NOT_VIDEO");
  }
  const updated = await db.media.update({ where: { id: m.id }, data: { status: "processing", size: st.size } });
  await enqueue("VIDEO_PROCESS", { mediaId: m.id });
  return json({ media: await mediaView(updated) });
});
