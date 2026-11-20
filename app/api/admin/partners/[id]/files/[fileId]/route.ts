import { Readable } from "node:stream";
import { HttpError } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { PARTNER_FILE_TYPES } from "@/lib/partners/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A creator's attachment, streamed to a signed-in admin. Never a public or signed storage URL. */
export const GET = adminRoute<{ params: { id: string; fileId: string } }>("partners", async (_req, { params }) => {
  const file = await db.partnerFile.findFirst({ where: { id: params.fileId.slice(0, 40), applicationId: params.id.slice(0, 40) } });
  if (!file) throw new HttpError(404, "That file no longer exists.", "NOT_FOUND");
  const obj = await storage.read(file.key).catch(() => null);
  if (!obj) throw new HttpError(404, "That file is missing from storage.", "NOT_FOUND");
  const type = (PARTNER_FILE_TYPES as readonly string[]).includes(file.mime) ? file.mime : "application/octet-stream";
  const name = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "attachment";
  return new Response(Readable.toWeb(obj.stream) as ReadableStream, {
    headers: {
      "Content-Type": type,
      ...(obj.size ? { "Content-Length": String(obj.size) } : {}),
      "Content-Disposition": `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(file.name.slice(0, 120))}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}, [120, 60_000]);
