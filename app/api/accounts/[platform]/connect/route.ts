import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { isPlatform } from "@/lib/domain";
import { getPublisher, hasCredentials, loadKeys, practiceAllowed } from "@/lib/social/registry";
import { instagramIdLooksLikeMetaAppId } from "@/lib/social/keys";
import { safeReturnTo, saveOAuthState } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

/** Step 1 of OAuth 2.0: we redirect to the platform. We never see the creator's password. */
export async function GET(req: NextRequest, { params }: { params: { platform: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL));
  if (!isPlatform(params.platform)) return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  // Inside a teammate's workspace `user` is the OWNER, so connecting here would replace the owner's
  // channel with the teammate's. Only the owner manages connected accounts.
  if (user.role !== "owner") {
    const back = new URL(safeReturnTo(req.nextUrl.searchParams.get("returnTo")), env.APP_URL);
    back.searchParams.set("connect_error", params.platform);
    back.searchParams.set("reason", "owner_only");
    return NextResponse.redirect(back);
  }
  await loadKeys();
  // No keys and not in rehearsal mode: say so plainly instead of handing out a pretend account.
  if (!hasCredentials(params.platform) && !practiceAllowed()) {
    const back = new URL(safeReturnTo(req.nextUrl.searchParams.get("returnTo")), env.APP_URL);
    back.searchParams.set("connect_error", params.platform);
    back.searchParams.set("reason", "not_configured");
    return NextResponse.redirect(back);
  }
  // Sending the creator to instagram.com with the Meta App ID only ends on "Invalid platform app". Say why instead.
  if (params.platform === "instagram" && instagramIdLooksLikeMetaAppId()) {
    const back = new URL(safeReturnTo(req.nextUrl.searchParams.get("returnTo")), env.APP_URL);
    back.searchParams.set("connect_error", "instagram");
    back.searchParams.set("reason", "wrong_app_id");
    return NextResponse.redirect(back);
  }
  const redirectUri = `${env.APP_URL}/api/accounts/${params.platform}/callback`;
  const start = await getPublisher(params.platform).connect(redirectUri);
  saveOAuthState(params.platform, { state: start.state, verifier: start.codeVerifier, returnTo: safeReturnTo(req.nextUrl.searchParams.get("returnTo")) });
  return NextResponse.redirect(start.url);
}
