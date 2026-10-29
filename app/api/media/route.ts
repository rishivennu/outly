import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError, json, route } from "@/lib/http";
import { storage, UploadTooLargeError } from "@/lib/storage";
import { ALLOWED_EXT, ALLOWED_VIDEO_MIME, looksLikeIsoBmff } from "@/lib/media/probe";
import { enqueue } from "@/lib/queue";
import { mediaView } from "@/lib/services";
import { assertStorage, assertUploadSize, storageUsage, uploadLimitBytes } from "@/lib/billing/entitlements";
import { fitsStorage } from "@/lib/billing/access-core";

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
    if (declared > max) await assertUploadSize(user.id, declared);
    // What this upload holds against the plan while it streams. With no length header, hold the most it may
    // be (the per-file limit): the sweeper treats an object bigger than its hold as abuse and removes it.
    const hold = declared > 0 ? declared : max;
    // Total storage (1052): refuse up front when the declared size can't fit, before any bytes are stored.
    await assertStorage(user.id, hold);
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
    // Hold the declared size against the allowance while the bytes stream in (like the direct route does), so
    // two uploads started together can't both squeeze into the same free space. A dead request leaves an
    // "uploading" row that sweepDirectUploads clears.
    const held = await db.media.create({
      data: { userId: user.id, originalFilename: filename, storageKey: key, mimeType: mime, size: hold, status: "uploading" },
    });
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

    // The body may have been bigger than it said (or said nothing): record the real size, then check the total
    // with every other upload counted. If it doesn't fit, the file comes back out, so storage never passes the plan.
    const won = await db.media.updateMany({ where: { id: held.id, status: "uploading" }, data: { size } });
    if (won.count !== 1) {
      await drop(true);
      throw new HttpError(409, "That upload was cancelled. Try it again.", "UPLOAD_GONE");
    }
    const u = await storageUsage(user.id);
    if (!fitsStorage(u.usedBytes, u.storageMb, 0)) {
      await drop(true);
      // With this file gone again, the usual check words the reason ("this file is X and you have Y left").
      await assertStorage(user.id, size);
      throw new HttpError(413, "There isn't room for this file right now. Try again in a moment.", "STORAGE_FULL");
    }
    const media = await db.media.update({ where: { id: held.id }, data: { status: "processing" } });
    await enqueue("VIDEO_PROCESS", { mediaId: media.id });
    return json({ media: await mediaView(media) }, { status: 201 });
  },
  { limit: [20, 60_000] },
);
