import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { REF_COOKIE, REF_DAYS, isCode } from "@/lib/referral-core";

export const dynamic = "force-dynamic";

/** Share link: remember who sent the visitor for 30 days, then show signup. */
export function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toLowerCase();
  const res = NextResponse.redirect(new URL(isCode(code) ? "/signup?ref=1" : "/signup", env.APP_URL));
  if (isCode(code) && !req.cookies.get(REF_COOKIE)) {
    res.cookies.set(REF_COOKIE, code, { path: "/", httpOnly: true, sameSite: "lax", secure: env.APP_URL.startsWith("https:"), maxAge: 60 * 60 * 24 * REF_DAYS });
  }
  return res;
}
