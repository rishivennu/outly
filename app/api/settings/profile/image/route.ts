import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { storage } from "@/lib/storage";
import { IMG_PREFIX, imgKey, isProfileImg } from "@/lib/profile-card-core";

export const runtime = "nodejs";

/** The cropper sends exactly these sizes (components/profile/ImageCropper.tsx); anything bigger is not from it. */
const MAX_BYTES = { avatar: 1.5 * 1024 * 1024, banner: 3 * 1024 * 1024 } as const;
type Kind = keyof typeof MAX_BYTES;

function kindOf(req: Request): Kind {
  const k = new URL(req.url).searchParams.get("kind");
  if (k === "avatar" || k === "banner") return k;
  throw new HttpError(400, "Say which picture: avatar or banner.");
}

/** JPEG start/end markers and the frame size, read from the bytes (never trust the content-type alone). */
function jpegSize(b: Buffer): { w: number; h: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

async function dropOld(value: string | null | undefined, kind: Kind, uid: string) {
  // Only ever this person's own picture of this kind, whatever ends up in the column.
  if (!isProfileImg(value, kind) || !value.slice(IMG_PREFIX.length).startsWith(`${kind}-${uid.toLowerCase()}-`)) return;
  const key = imgKey(value.slice(IMG_PREFIX.length));
  if (key) await storage.remove(key).catch(() => {});
}

/** 1120: a cropped profile picture or cover (JPEG from the in-browser cropper). Replaces the one before. */
export const PUT = route(async (req, { user }) => {
  if (user.actor) throw new HttpError(403, "Only the studio owner can change this.", "NOT_OWNER");
  const kind = kindOf(req);
  if (req.headers.get("content-type") !== "image/jpeg") throw new HttpError(415, "Send the picture as a JPEG.");
  // Refuse on the declared size before reading anything, so a huge body is never buffered (the check after
  // the read is the backstop for a missing or lying content-length).
  const declared = Number(req.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0 || declared > MAX_BYTES[kind]) throw new HttpError(413, "That picture is too large. Try a smaller one.");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > MAX_BYTES[kind]) throw new HttpError(413, "That picture is too large. Try a smaller one.");
  const size = jpegSize(buf);
  if (!size) throw new HttpError(415, "That doesn't look like a picture.");
  const ok = kind === "avatar" ? size.w >= 128 && size.w <= 1024 && size.w === size.h : size.w >= 600 && size.w <= 3000 && Math.abs(size.w / size.h - 3) < 0.05;
  if (!ok) throw new HttpError(422, kind === "avatar" ? "The picture should be square." : "The cover should be three times as wide as it is tall.");

  const name = `${kind}-${user.id.toLowerCase()}-${randomBytes(8).toString("hex")}`;
  const key = imgKey(name);
  if (!key) throw new HttpError(500, "Couldn't save that picture.");
  await storage.put(key, buf, "image/jpeg", MAX_BYTES[kind]);
  const url = IMG_PREFIX + name;
  const before = await db.user.findUnique({ where: { id: user.id }, select: { avatar: true, banner: true } });
  await db.user.update({ where: { id: user.id }, data: kind === "avatar" ? { avatar: url } : { banner: url } });
  await dropOld(kind === "avatar" ? before?.avatar : before?.banner, kind, user.id);
  return json({ url });
}, { limit: [20, 60_000] });

/** Remove the picture: the avatar falls back to your orb, the cover to the theme's own art. */
export const DELETE = route(async (req, { user }) => {
  if (user.actor) throw new HttpError(403, "Only the studio owner can change this.", "NOT_OWNER");
  const kind = kindOf(req);
  const before = await db.user.findUnique({ where: { id: user.id }, select: { avatar: true, banner: true } });
  const cur = kind === "avatar" ? before?.avatar : before?.banner;
  // Only an uploaded avatar is removed here; a chosen orb stays (it is changed in the orb picker).
  if (kind === "avatar" && !isProfileImg(cur)) return json({ ok: true });
  await db.user.update({ where: { id: user.id }, data: kind === "avatar" ? { avatar: null } : { banner: null } });
  await dropOld(cur, kind, user.id);
  return json({ ok: true });
});
