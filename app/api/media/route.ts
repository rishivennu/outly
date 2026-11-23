import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError, json, route } from "@/lib/http";
import { storage, UploadTooLargeError } from "@/lib/storage";
import { ALLOWED_EXT, ALLOWED_VIDEO_MIME, looksLikeIsoBmff } from "@/lib/media/probe";
import { enqueue } from "@/lib/queue";
import { mediaView } from "@/lib/services";
import { assertUploadSize, uploadLimitBytes } from "@/lib/billing/entitlements";
import { recordUpload, reserveUpload, sizeColumns } from "@/lib/storage/quota";
import { track } from "@/lib/analytics/activity";
import { realUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streaming upload: raw body (not multipart) so a 500 MB file never sits in memory. */
export const POST = route(
  async (req, { user }) => {
    const filename = (req.nextUrl.searchParams.get("name") ?? "video.mp4").slice(0, 200);
    const mime = req.headers.get("content-type")?.split(";")[0] ?? "";
    const ext = extname(filename).toLowerCase();
    const lim = await uploadLimitBytes(user.id);
    const max = lim.bytes;
    const declared = Number(req.headers.get("content-length") ?? 0);

    if (!(ALLOWED_VIDEO_MIME as readonly string[]).includes(mime) || !(ALLOWED_EXT as readonly string[]).includes(ext))
      throw new HttpError(415, "That one isn't a video we can use yet. Try an MP4 or MOV.");
    // What this upload holds against the plan while it streams. With no length header, hold the most it may
    // be (the per-file limit): the sweeper treats an object bigger than its hold as abuse and removes it.
    const hold = declared > 0 ? declared : max;
    if (!req.body) throw new HttpError(400, "The upload arrived empty.");

    // Peek at the first bytes to confirm it really is an MP4/MOV container.
    const reader = req.body.getReader();
    const first = await reader.read();
    if (first.done || !first.value || !looksLikeIsoBmff(first.value)) {
      await reader.cancel();
      throw new HttpError(415, "That file says it's a video, but it doesn't look like one.");
    }
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(first.value!);
      },
      async pull(c) {
        const { done, value } = await reader.read();
        if (done) c.close();
        else c.enqueue(value);
      },
      cancel() {
        reader.cancel();
      },
    });

    const id = randomUUID();
    const key = `videos/${user.id}/${id}${ext}`;
    // R1209: hold the declared size against the monthly allowance and storage while the bytes stream in (checked
    // and held in one locked step, like the direct route). A dead request leaves an "uploading" row that
    // sweepDirectUploads clears.
    let held: Awaited<ReturnType<typeof db.media.create>>;
    try {
      held = await reserveUpload(user.id, hold, (tx) => tx.media.create({ data: { userId: user.id, originalFilename: filename, storageKey: key, mimeType: mime, ...sizeColumns(hold), status: "uploading" } }));
    } catch (e) {
      await reader.cancel().catch(() => {});
      throw e;
    }
    const drop = async (removeFile: boolean) => {
      if (removeFile) await storage.remove(key).catch(() => {});
      await db.media.deleteMany({ where: { id: held.id, status: "uploading" } }).catch(() => {});
    };
    let size: number;
    try {
      ({ size } = await storage.put(key, stream, mime, max));
    } catch (e) {
      await drop(true);
      if (e instanceof UploadTooLargeError) {
        await assertUploadSize(user.id, max + 1);
        throw new HttpError(413, `That's a big one. Keep it under ${env.MAX_UPLOAD_MB} MB.`);
      }
      throw e;
    }

    // A body bigger than the length it declared was never held, so it comes back out: usage never passes the plan.
    if (size > hold) {
      await drop(true);
      throw new HttpError(413, "That upload was bigger than it said. Try it again.", "STORAGE_FULL");
    }
    const won = await db.media.updateMany({ where: { id: held.id, status: "uploading" }, data: { ...sizeColumns(size), status: "processing" } });
    if (won.count !== 1) {
      await drop(true);
      throw new HttpError(409, "That upload was cancelled. Try it again.", "UPLOAD_GONE");
    }
    await recordUpload(held, size);
    track("video_uploaded", realUserId(user), { kind: "video" });
    const media = await db.media.findUniqueOrThrow({ where: { id: held.id } });
    await enqueue("VIDEO_PROCESS", { mediaId: media.id });
    return json({ media: await mediaView(media) }, { status: 201 });
  },
  { limit: [20, 60_000] },
);
