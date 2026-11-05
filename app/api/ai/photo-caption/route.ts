import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { storage } from "@/lib/storage";
import { realUserId } from "@/lib/auth";
import { chargeAi } from "@/lib/ai-quota";
import { voiceFor } from "@/lib/ai/voice";
import { generatePhotoCopy } from "@/lib/ai/photo-caption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  mediaIds: z.array(z.string().cuid()).min(1, "Add a photo first.").max(20),
  format: z.enum(["photo", "carousel"]),
  /** Asked by the composer on its own (photos just finished uploading): a plan or quota stop is a quiet skip, not an error. */
  auto: z.boolean().optional(),
});

/** Gemini takes about 20 MB per request, and base64 adds a third: stop adding photos past this many raw bytes. */
const BUDGET = 12 * 1024 * 1024;

async function bytesOf(key: string) {
  const { stream } = await storage.read(key);
  const parts: Buffer[] = [];
  for await (const c of stream) parts.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
  return Buffer.concat(parts);
}

/**
 * 1133: the Outlly assistant reads the post's photos and writes the caption, hashtags and one description per
 * photo. Only the caller's own JPEGs are read; videos in a carousel are left out (and get no description).
 */
export const POST = route(
  async (req, { user }) => {
    const { mediaIds, format, auto } = schema.parse(await req.json());
    const rows = await db.media.findMany({ where: { id: { in: mediaIds }, userId: user.id, mimeType: "image/jpeg" }, select: { id: true, storageKey: true, size: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const picked: { id: string; key: string }[] = [];
    let total = 0;
    for (const id of mediaIds) {
      const r = byId.get(id);
      if (!r || picked.some((p) => p.id === id)) continue;
      if (total + r.size > BUDGET) break;
      total += r.size;
      picked.push({ id, key: r.storageKey });
    }
    if (!picked.length) {
      if (auto) return json({ skipped: "no_photos" });
      throw new HttpError(400, "The assistant reads photos. Add a photo first.");
    }

    const uid = realUserId(user);
    try {
      await chargeAi(uid);
    } catch (e) {
      if (auto && e instanceof HttpError) return json({ skipped: e.code ?? "limit" });
      throw e;
    }
    const images = await Promise.all(picked.map(async (p) => ({ mime: "image/jpeg", data: (await bytesOf(p.key)).toString("base64") })));
    const out = await generatePhotoCopy(images, format, { signal: req.signal, voice: await voiceFor(uid), cacheKey: uid });
    if (!out) {
      if (auto) return json({ skipped: "busy" });
      throw new HttpError(503, "The assistant couldn't look at your photos just now. Try again in a moment, or write your own.", "AI_BUSY");
    }
    return json({ caption: out.caption, hashtags: out.hashtags, slides: picked.map((p, i) => ({ mediaId: p.id, altText: out.alts[i] ?? "" })) });
  },
  { limit: [20, 60_000] },
);
