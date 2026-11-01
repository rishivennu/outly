import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { storage } from "@/lib/storage";
import { ownedPost, safeSignedUrl } from "@/lib/services";
import { COVER_MAX_BYTES } from "@/lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Once it has gone out, the platforms already have their cover; changing it here would only mislead. */
function assertEditable(status: string) {
  if (status === "publishing" || status === "published") throw new HttpError(409, "This one has already gone out, so the cover can't change here.");
}

/**
 * 1083: the creator's own cover image. The browser always sends one JPEG (it converts PNG/WebP and shrinks it
 * under 2 MB first), so every platform that takes a cover gets the same file.
 */
export const PUT = route(
  async (req, { user, params }) => {
    const post = await ownedPost(user.id, params.id);
    assertEditable(post.status);
    if (req.headers.get("content-type")?.split(";")[0] !== "image/jpeg") throw new HttpError(415, "The cover needs to be a JPEG.");
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) throw new HttpError(400, "The cover arrived empty.");
    if (buf.length > COVER_MAX_BYTES) throw new HttpError(413, "That cover is over 2 MB. Try a smaller image.");
    if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw new HttpError(415, "That file doesn't look like a JPEG image.");
    const key = `covers/${user.id}/${post.id}-${randomUUID()}.jpg`;
    await storage.put(key, buf, "image/jpeg");
    // Conditional, so a cover can't land on a post that started sending while this one uploaded.
    const r = await db.post.updateMany({ where: { id: post.id, status: { notIn: ["publishing", "published"] } }, data: { coverKey: key } });
    if (!r.count) {
      await storage.remove(key).catch(() => {});
      throw new HttpError(409, "This one has already gone out, so the cover can't change here.");
    }
    // A new cover means every platform should take it again on the next send.
    await db.postTarget.updateMany({ where: { postId: post.id, platformStatus: { not: "published" } }, data: { coverSetAt: null, coverError: null } });
    if (post.coverKey) await storage.remove(post.coverKey).catch(() => {});
    return json({ coverUrl: await safeSignedUrl(key) });
  },
  { limit: [30, 60_000] },
);

export const DELETE = route(async (_req, { user, params }) => {
  const post = await ownedPost(user.id, params.id);
  assertEditable(post.status);
  if (!post.coverKey) return json({ coverUrl: null });
  await db.post.update({ where: { id: post.id }, data: { coverKey: null } });
  await db.postTarget.updateMany({ where: { postId: post.id, platformStatus: { not: "published" } }, data: { coverSetAt: null, coverError: null } });
  await storage.remove(post.coverKey).catch(() => {});
  return json({ coverUrl: null });
});
