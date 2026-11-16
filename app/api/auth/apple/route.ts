import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { appleAuthorizeUrl, appleConfigured, randomToken, saveAppleState } from "@/lib/apple-auth";
import { sameSitePath } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

/** Sign in (or up) with Apple, step 1: remember who asked, then hand over to Apple's own sign-in page. */
export async function GET(req: NextRequest) {
  // Apple only returns to the one registered address (APP_URL), so start there or the state cookie is left behind.
  const home = new URL(env.APP_URL);
  const here = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  if (process.env.NODE_ENV === "production" && here && here !== home.host) {
    return NextResponse.redirect(new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, home));
  }
  const from = req.nextUrl.searchParams.get("from") === "signup" ? "signup" : "login";
  if (!appleConfigured()) return NextResponse.redirect(new URL(`/${from}?apple_error=not_configured`, env.APP_URL));
  const rm = req.nextUrl.searchParams.get("remember");
  const state = randomToken();
  const nonce = randomToken();
  await saveAppleState({ state, nonce, from, returnTo: sameSitePath(req.nextUrl.searchParams.get("next")) ?? "/home", remember: rm === "1" ? true : rm === "0" ? false : undefined });
  return NextResponse.redirect(appleAuthorizeUrl({ state, nonce }));
}
