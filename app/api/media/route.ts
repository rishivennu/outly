import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError, json, route } from "@/lib/http";
import { storage, UploadTooLargeError } from "@/lib/storage";
import { ALLOWED_EXT, ALLOWED_VIDEO_MIME, looksLikeIsoBmff } from "@/lib/media/probe";
import { enqueue } from "@/lib/queue";
import { mediaView } from "@/lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streaming upload: raw body (not multipart) so a 500 MB file never sits in memory. */
export const POST = route(
  async (req, { user }) => {
    const filename = (req.nextUrl.searchParams.get("name") ?? "video.mp4").slice(0, 200);
    const mime = req.headers.get("content-type")?.split(";")[0] ?? "";
    const ext = extname(filename).toLowerCase();
    const max = env.MAX_UPLOAD_MB * 1024 * 1024;
    const declared = Number(req.headers.get("content-length") ?? 0);

    if (!(ALLOWED_VIDEO_MIME as readonly string[]).includes(mime) || !(ALLOWED_EXT as readonly string[]).includes(ext))
      throw new HttpError(415, "That one isn't a video we can use yet. Try an MP4 or MOV.");
    if (declared > max) throw new HttpError(413, `That's a big one. Keep it under ${env.MAX_UPLOAD_MB} MB.`);
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
    let size: number;
    try {
      ({ size } = await storage.put(key, stream, mime, max));
    } catch (e) {
      if (e instanceof UploadTooLargeError) throw new HttpError(413, `That's a big one. Keep it under ${env.MAX_UPLOAD_MB} MB.`);
      throw e;
    }

    const media = await db.media.create({
      data: { userId: user.id, originalFilename: filename, storageKey: key, mimeType: mime, size, status: "processing" },
    });
    await enqueue("VIDEO_PROCESS", { mediaId: media.id });
    return json({ media: await mediaView(media) }, { status: 201 });
  },
  { limit: [20, 60_000] },
);
