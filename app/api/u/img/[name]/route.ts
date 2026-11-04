import { Readable } from "node:stream";
import { HttpError, route } from "@/lib/http";
import { storage } from "@/lib/storage";
import { imgKey } from "@/lib/profile-card-core";

export const runtime = "nodejs";

/**
 * 1120: an uploaded profile picture or cover. Storage is private, so pictures are streamed through here to signed-in
 * members. The name carries a random part that changes on every upload, so a copy can be cached for good.
 * Deliberate: any signed-in member who knows a name can read it (it is a profile picture, shown to teammates);
 * the 8 random bytes make names unguessable, and nothing else in storage is reachable from here.
 */
export const GET = route<{ params: { name: string } }>(async (_req, { params }) => {
  const key = imgKey(params.name);
  if (!key) throw new HttpError(404, "Not found");
  const obj = await storage.read(key).catch(() => null);
  if (!obj) throw new HttpError(404, "Not found");
  return new Response(Readable.toWeb(obj.stream) as ReadableStream, {
    headers: {
      "Content-Type": "image/jpeg",
      ...(obj.size ? { "Content-Length": String(obj.size) } : {}),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}, { limit: [600, 60_000] });
