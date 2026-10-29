import { NextResponse, type NextRequest } from "next/server";
import { destroySession, readSessionUserId } from "@/lib/auth";
import { sameSitePath } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

/**
 * A session the database no longer accepts (signed out everywhere, password changed, 2FA reset).
 * Middleware only checks the cookie's signature, so it kept sending /login to /home while the studio
 * sent /home back to /login: an endless loop that Chrome on iPhone shows as "ERR_FAILED" (1042).
 * Pages send such visitors here instead; the stale cookie is cleared and they land on sign-in.
 * A session that is still valid is left alone, so a link to this URL can't sign anyone out.
 */
export async function GET(req: NextRequest) {
  const next = sameSitePath(req.nextUrl.searchParams.get("next"));
  if (await readSessionUserId()) return NextResponse.redirect(new URL(next ?? "/home", req.url));
  destroySession();
  const to = new URL("/login", req.url);
  if (next && next !== "/login") to.searchParams.set("next", next);
  const res = NextResponse.redirect(to);
  res.headers.set("cache-control", "no-store");
  return res;
}
