import { NextResponse, type NextRequest } from "next/server";
import { Readable } from "node:stream";
import { storage, verifySignedKey } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", svg: "image/svg+xml" };

/**
 * Private storage gateway. The HMAC signature IS the authorization (platforms like
 * Instagram fetch without our cookie), and it expires. Supports Range for video seeking.
 */
export async function GET(req: NextRequest, { params }: { params: { key: string[] } }) {
  const key = params.key.join("/");
  const exp = Number(req.nextUrl.searchParams.get("exp"));
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  if (!exp || !verifySignedKey(key, exp, sig)) return new NextResponse("Link expired", { status: 403 });
  const st = await storage.stat(key).catch(() => null);
  if (!st) return new NextResponse("Not found", { status: 404 });
  const type = TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
  const headers: Record<string, string> = { "content-type": type, "accept-ranges": "bytes", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" };

  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${st.size}` } });
    const { stream } = await storage.read(key, { start, end });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": String(end - start + 1) },
    });
  }
  const { stream } = await storage.read(key);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, { headers: { ...headers, "content-length": String(st.size) } });
}
