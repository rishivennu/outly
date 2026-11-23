import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/** R1306: RFC 9116 section 3 allows the legacy top-level path; it points at the well-known one. */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.redirect(new URL("/.well-known/security.txt", env.APP_URL), 301);
}
