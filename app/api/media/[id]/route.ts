import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { mediaMetaSchema } from "@/lib/validation";
import { mediaView, ownedMedia } from "@/lib/services";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { user, params }) => {
  return json({ media: await mediaView(await ownedMedia(user.id, params.id)) });
});

/** Browser-extracted metadata; server-side ffprobe (if installed) overwrites it with authoritative values. */
export const PATCH = route(async (req, { user, params }) => {
  const m = await ownedMedia(user.id, params.id);
  const meta = mediaMetaSchema.parse(await req.json());
  const updated = await db.media.update({
    where: { id: m.id },
    data: {
      duration: m.duration ?? meta.duration,
      width: m.width ?? meta.width,
      height: m.height ?? meta.height,
      status: m.status === "processing" ? "ready" : m.status,
    },
  });
  return json({ media: await mediaView(updated) });
});
