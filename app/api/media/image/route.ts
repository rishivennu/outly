import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { storage, UploadTooLargeError } from "@/lib/storage";
import { jpegSize } from "@/lib/media/jpeg";
import { mediaView } from "@/lib/services";
import { assertStorage, storageUsage } from "@/lib/billing/entitlements";
import { fitsStorage } from "@/lib/billing/access-core";
import { MAX_IMAGE_BYTES } from "@/lib/formats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Under Vercel's 4.5 MB request cap: the browser sends a resized JPEG (lib/client/image.ts), usually 0.3 to 2 MB. */
const MAX_BODY = Math.min(MAX_IMAGE_BYTES, 4 * 1024 * 1024);

/**
 * 1131: one photo for a photo, carousel or story post. The body is the JPEG itself. It is small, so it is read
 * whole, checked (a real JPEG with a readable size), counted against storage and stored ready to use.
 */
export const POST = route(
  async (req, { user }) => {
    const filename = (req.nextUrl.searchParams.get("name") ?? "photo.jpg").slice(0, 200);
    const mime = req.headers.get("content-type")?.split(";")[0] ?? "";
    if (mime !== "image/jpeg") throw new HttpError(415, "Photos go up as JPEGs. Pick the photo again and Outlly will convert it.");
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY) throw new HttpError(413, "That photo is too big. Keep it under 4 MB.");
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) throw new HttpError(400, "The upload arrived empty.");
    if (bytes.length > MAX_BODY) throw new HttpError(413, "That photo is too big. Keep it under 4 MB.");
    const size = jpegSize(bytes);
    if (!size) throw new HttpError(415, "That file says it's a photo, but it doesn't look like one.");
    await assertStorage(user.id, bytes.length);

    const key = `images/${user.id}/${randomUUID()}.jpg`;
    try {
      await storage.put(key, Buffer.from(bytes), "image/jpeg", MAX_BODY);
    } catch (e) {
      if (e instanceof UploadTooLargeError) throw new HttpError(413, "That photo is too big. Keep it under 4 MB.");
      throw e;
    }
    const media = await db.media.create({
      data: { userId: user.id, originalFilename: filename, storageKey: key, mimeType: "image/jpeg", size: bytes.length, width: size.width, height: size.height, status: "ready" },
    });
    // Two uploads at once can both pass the check above: count again with this one stored, and take it back if it doesn't fit.
    const u = await storageUsage(user.id);
    if (!fitsStorage(u.usedBytes, u.storageMb, 0)) {
      await db.media.delete({ where: { id: media.id } }).catch(() => {});
      await storage.remove(key).catch(() => {});
      await assertStorage(user.id, bytes.length);
      throw new HttpError(413, "There isn't room for this photo right now. Try again in a moment.", "STORAGE_FULL");
    }
    return json({ media: await mediaView(media) }, { status: 201 });
  },
  { limit: [60, 60_000] },
);
