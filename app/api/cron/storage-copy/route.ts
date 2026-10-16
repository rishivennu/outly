import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { makeS3 } from "@/lib/storage/s3x";
import { r2Config, r2Configured } from "@/lib/storage";
import { sbStorage, supabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One-off move from Supabase Storage to Cloudflare R2. Copies every video and thumbnail the
 * database knows about, oldest first, skipping keys R2 already has at the same size. Safe to call
 * again and again; each call works for ~45 s and returns `next` (a cursor) until it is null.
 *
 *   POST /api/cron/storage-copy?cursor=<next>     Authorization: Bearer $CRON_SECRET
 *
 * Works whatever STORAGE_DRIVER is, so it can run before AND after the switch.
 */
export async function POST(req: NextRequest) {
  if (!env.CRON_SECRET) return NextResponse.json({ error: "Set CRON_SECRET first." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!r2Configured()) return NextResponse.json({ error: "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET first." }, { status: 503 });
  if (!supabaseConfigured()) return NextResponse.json({ error: "Supabase storage is not configured, nothing to copy from." }, { status: 503 });

  const r2 = makeS3(r2Config());
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const until = Date.now() + 45_000;
  const rows = await db.media.findMany({
    where: { status: { notIn: ["uploading", "failed"] } },
    orderBy: { id: "asc" },
    take: 200,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, storageKey: true, thumbnailKey: true, mimeType: true },
  });

  const out = { copied: 0, skipped: 0, missing: 0, failed: [] as string[], next: null as string | null };
  for (const m of rows) {
    if (Date.now() > until) break;
    for (const [key, type] of [[m.storageKey, m.mimeType], [m.thumbnailKey, "image/jpeg"]] as const) {
      if (!key || key.startsWith("/")) continue; // "/..." = a bundled placeholder, not a stored object
      try {
        const src = await sbStorage.info(key);
        if (!src) {
          out.missing++;
          continue;
        }
        const have = await r2.head(key);
        if (have && have.size === src.size) {
          out.skipped++;
          continue;
        }
        const r = await sbStorage.get(key);
        await r2.put(key, Buffer.from(await r.arrayBuffer()), src.mimetype || type || "application/octet-stream");
        out.copied++;
      } catch (e) {
        console.error("[storage-copy]", key, e);
        out.failed.push(key);
      }
    }
    out.next = m.id;
  }
  // Finished this page completely and it was the last one: done.
  if (rows.length < 200 && out.next === rows.at(-1)?.id) out.next = null;
  return NextResponse.json(out);
}
