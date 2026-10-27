import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { hasCredentials, loadKeys } from "@/lib/social/registry";
import { YouTubePublisher } from "@/lib/social/youtube";
import { safeReturnTo, saveOAuthState } from "@/lib/oauth-state";
import { isNativeUA } from "@/lib/app-mode";
import { APP_AUTH_PAGE } from "@/lib/app-handoff";

export const dynamic = "force-dynamic";

/**
 * Continue with Google: one consent screen that signs the creator in AND links their YouTube channel.
 * It reuses the YouTube callback URL, so no extra redirect URI has to be registered in Google Cloud.
 */
export async function GET(req: NextRequest) {
  // Google always comes back to APP_URL. Started on any other host (a preview URL, www vs bare, a second
  // domain) the state cookie would be left behind there and the sign-in would bounce. Hop over first.
  const home = new URL(env.APP_URL);
  const here = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  if (process.env.NODE_ENV === "production" && here && here !== home.host) {
    return NextResponse.redirect(new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, home));
  }
  const from = req.nextUrl.searchParams.get("from") === "signup" ? "/signup" : "/login";
  await loadKeys();
  if (!hasCredentials("youtube")) return NextResponse.redirect(new URL(`${from}?google_error=not_configured`, env.APP_URL));
  // Google blocks its sign-in inside app WebViews ("disallowed_useragent"): the app finishes it in a Custom Tab.
  if (isNativeUA(req.headers.get("user-agent"))) {
    const to = new URL(APP_AUTH_PAGE, env.APP_URL);
    to.searchParams.set("to", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(to);
  }
  const redirectUri = `${env.APP_URL}/api/accounts/youtube/callback`;
  const start = await new YouTubePublisher().connect(redirectUri, { identity: true });
  saveOAuthState("youtube", { state: start.state, returnTo: safeReturnTo(req.nextUrl.searchParams.get("next") ?? "/home"), mode: "login" });
  return NextResponse.redirect(start.url);
}
