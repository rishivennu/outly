import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { hasCredentials } from "@/lib/social/registry";
import { YouTubePublisher } from "@/lib/social/youtube";
import { safeReturnTo, saveOAuthState } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

/**
 * Continue with Google: one consent screen that signs the creator in AND links their YouTube channel.
 * It reuses the YouTube callback URL, so no extra redirect URI has to be registered in Google Cloud.
 */
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from") === "signup" ? "/signup" : "/login";
  if (!hasCredentials("youtube")) return NextResponse.redirect(new URL(`${from}?google_error=not_configured`, env.APP_URL));
  const redirectUri = `${env.APP_URL}/api/accounts/youtube/callback`;
  const start = await new YouTubePublisher().connect(redirectUri, { identity: true });
  saveOAuthState("youtube", { state: start.state, returnTo: safeReturnTo(req.nextUrl.searchParams.get("next") ?? "/home"), mode: "login" });
  return NextResponse.redirect(start.url);
}
