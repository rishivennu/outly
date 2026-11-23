import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { securityTxt } from "@/lib/security-txt";

/** R1306: RFC 9116 security.txt at the well-known path (body and expiry: lib/security-txt.ts). */
export const dynamic = "force-dynamic";

export function GET() {
  return new NextResponse(securityTxt(new URL(env.APP_URL).origin), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}
