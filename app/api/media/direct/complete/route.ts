import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { storage } from "@/lib/storage";
import { looksLikeIsoBmff } from "@/lib/media/probe";
import { enqueue } from "@/lib/queue";
import { mediaView, ownedMedia } from "@/lib/services";
import { claimFinalize, legacyPartSize, recordParts, releaseFinalize, sessionClosed } from "@/lib/media/upload-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const part = z.object({ n: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(200), size: z.number().int().positive() });
const body = z.object({
  mediaId: z.string().min(1),
  uploadId: z.string().min(1).max(1024).optional(),
  /** R1193: the last parts that landed, recorded on the session before the stitch */
  done: z.array(part).max(48).default([]),
});

/** What the bucket holds must be parts 1..N, every one but the last the same size, adding up to the file. */
function covers(parts: { n: number; size: number }[], size: number, partSize: number) {
  const total = Math.ceil(size / partSize);
  if (parts.length !== total || parts.some((p, i) => p.n !== i + 1)) return false;
  if (parts.slice(0, -1).some((p) => p.size !== partSize)) return false;
  return parts.reduce((a, p) => a + p.size, 0) === size;
}

/**
 * Step 2: the browser says it's done. We verify the object really landed, is the declared size and is an MP4/MOV.
 * R1193: two completes at once (a retry racing the first, two tabs) can't both stitch and both queue processing:
 * a multipart session is claimed ("finalizing") before the stitch, and the media row is claimed before the enqueue.
 */
export const POST = route(async (req, { user }) => {
  const b = body.parse(await req.json());
  const m = await ownedMedia(user.id, b.mediaId);
  if (m.status !== "uploading") return json({ media: await mediaView(m) }); // idempotent
  const mp = storage.multipart;
  const s = await db.uploadSession.findUnique({ where: { mediaId: m.id } });
  if (s && b.uploadId && b.uploadId !== s.uploadId) throw new HttpError(409, "That upload doesn't match this video. Drop it again to start fresh.", "UPLOAD_MISMATCH");
  if (s && sessionClosed(s)) throw new HttpError(410, "That upload expired. Drop the video again and we'll start fresh.", "EXPIRED");
  const uploadId = s?.uploadId ?? b.uploadId;
  if (s) {
    if (b.done.length) await recordParts(s, b.done);
    if (!(await claimFinalize(s.id))) {
      // Another request is stitching this upload right now. The browser asks again in a moment and gets its answer.
      const now = await db.media.findUnique({ where: { id: m.id } });
      if (now && now.status !== "uploading") return json({ media: await mediaView(now) });
      throw new HttpError(409, "Almost there. We're still putting your video together.", "FINALIZING");
    }
  }
  const fail = async (status: "failed" | "release") => {
    if (!s) return;
    if (status === "release") await releaseFinalize(s.id);
    else await db.uploadSession.update({ where: { id: s.id }, data: { status: "failed" } });
  };

  let st: { size: number } | null;
  try {
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
        if (!covers(parts, m.size, s?.chunkSize ?? legacyPartSize(parts, m.size))) {
          if (s) await recordParts(s, parts.map((p) => ({ n: p.n, etag: p.etag, size: p.size })));
          throw new HttpError(409, "Some of the video is still missing. Let's finish that upload.", "PARTS_MISSING");
        }
        await mp.complete(m.storageKey, uploadId, parts);
      }
    }
    st = await storage.stat(m.storageKey);
  } catch (e) {
    await fail("release");
    throw e;
  }
  if (!st) {
    await fail("release");
    throw new HttpError(409, "We didn't receive the video yet. Let's try that upload again.", "NOT_UPLOADED");
  }
  if (Math.abs(st.size - m.size) > 0) {
    await storage.remove(m.storageKey).catch(() => {});
    await db.media.update({ where: { id: m.id }, data: { status: "failed" } });
    await fail("failed");
    throw new HttpError(422, "The upload arrived incomplete. Let's try again.", "SIZE_MISMATCH");
  }
  const { stream } = await storage.read(m.storageKey, { start: 0, end: 31 });
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  if (!looksLikeIsoBmff(Buffer.concat(chunks))) {
    await storage.remove(m.storageKey).catch(() => {});
    await db.media.update({ where: { id: m.id }, data: { status: "failed" } });
    await fail("failed");
    throw new HttpError(415, "That file says it's a video, but it doesn't look like one.", "NOT_VIDEO");
  }
  // Claim the row before queueing: only the request that moves it on queues processing (Cancel may have won).
  const claimed = await db.media.updateMany({ where: { id: m.id, status: "uploading" }, data: { status: "processing", size: st.size } });
  if (claimed.count === 1) await enqueue("VIDEO_PROCESS", { mediaId: m.id });
  if (s) await db.uploadSession.update({ where: { id: s.id }, data: { status: claimed.count === 1 ? "completed" : "aborted", completedParts: claimed.count === 1 ? s.totalParts : undefined } });
  const updated = await db.media.findUniqueOrThrow({ where: { id: m.id } });
  if (claimed.count !== 1 && updated.status === "failed") {
    // Cancel (or the sweeper) won while this request was stitching: its remove ran before the object existed,
    // so the file this stitch just made would be left behind with nothing counting or sweeping it.
    await storage.remove(m.storageKey).catch(() => {});
    throw new HttpError(409, "That upload was cancelled.", "CANCELLED");
  }
  return json({ media: await mediaView(updated) });
});
