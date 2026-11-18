import { z } from "zod";
import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { storage } from "@/lib/storage";
import { ownedMedia } from "@/lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  mediaId: z.string().min(1),
  /** Only for multipart uploads started before R1193, which have no session to read the upload id from. */
  uploadId: z.string().min(1).max(1024).optional(),
});

/**
 * R1193: Cancel. Tells the bucket to drop the parts of the caller's own unfinished upload and frees the space it
 * held against their storage. The row is claimed first, so a completion racing this keeps its file.
 * A finished upload is left alone (it is a video in the library by then).
 */
export const POST = route(
  async (req, { user }) => {
    const b = body.parse(await req.json());
    const m = await ownedMedia(user.id, b.mediaId);
    if (m.status !== "uploading") return json({ ok: true, status: m.status });
    const r = await db.media.updateMany({ where: { id: m.id, status: "uploading" }, data: { status: "failed" } });
    if (r.count !== 1) return json({ ok: true });
    const s = await db.uploadSession.findUnique({ where: { mediaId: m.id } });
    const uploadId = s?.uploadId ?? b.uploadId;
    if (uploadId && storage.multipart) await storage.multipart.abort(m.storageKey, uploadId).catch(() => {});
    if (s) await db.uploadSession.update({ where: { id: s.id }, data: { status: "aborted" } });
    await storage.remove(m.storageKey).catch(() => {});
    return json({ ok: true, status: "cancelled" });
  },
  { limit: [30, 60_000] },
);
