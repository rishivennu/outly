import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { WS_COOKIE } from "@/lib/team/roles";
import { APP_DEEP_LINK, appCookie, claimStart, readStart } from "@/lib/app-handoff";

export const dynamic = "force-dynamic";

/** Step 2 (in the Custom Tab): sign the browser in as the app's user, remember the challenge, go to the real flow. */
export async function GET(req: NextRequest) {
  const start = await readStart(req.nextUrl.searchParams.get("t"));
  if (!start || (start.uid && !(await claimStart(start.uid, start.jti)))) return NextResponse.redirect(`${APP_DEEP_LINK}?error=expired`);
  if (start.uid) {
    await createSession(start.uid);
    // A teammate workspace picked earlier in this browser would make the connect run as that workspace.
    cookies().delete(WS_COOKIE);
  }
  const res = NextResponse.redirect(new URL(start.to, env.APP_URL));
  res.cookies.set(appCookie(start.ch));
  return res;
}
