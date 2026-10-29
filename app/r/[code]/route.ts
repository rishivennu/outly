import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { isCode } from "@/lib/referral-core";

export const dynamic = "force-dynamic";

/** Old share link (before 1052): lands on /signup?ref=CODE, where the middleware remembers who sent the visitor. */
export function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toLowerCase();
  return NextResponse.redirect(new URL(isCode(code) ? `/signup?ref=${code}` : "/signup", env.APP_URL));
}
