import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { storage } from "@/lib/storage";
import { mediaView, ownedMedia } from "@/lib/services";

export const runtime = "nodejs";

/** Poster frame captured in the browser (canvas → JPEG). */
export const PUT = route(async (req, { user, params }) => {
  const m = await ownedMedia(user.id, params.id);
  if (req.headers.get("content-type") !== "image/jpeg") throw new HttpError(415, "Thumbnail must be a JPEG.");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > 3 * 1024 * 1024) throw new HttpError(413, "Thumbnail too large.");
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new HttpError(415, "Thumbnail must be a JPEG.");
  const key = `thumbs/${user.id}/${m.id}.jpg`;
  await storage.put(key, buf, "image/jpeg");
  const updated = await db.media.update({ where: { id: m.id }, data: { thumbnailKey: key } });
  return json({ media: await mediaView(updated) });
});
