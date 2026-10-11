import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { storage } from "@/lib/storage";
import { looksLikeIsoBmff } from "@/lib/media/probe";
import { enqueue } from "@/lib/queue";
import { mediaView, ownedMedia } from "@/lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ mediaId: z.string().min(1) });

/** Step 2: the browser says it's done. We verify the object really landed, is the declared size and is an MP4/MOV. */
export const POST = route(async (req, { user }) => {
  const { mediaId } = body.parse(await req.json());
  const m = await ownedMedia(user.id, mediaId);
  if (m.status !== "uploading") return json({ media: await mediaView(m) }); // idempotent
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
