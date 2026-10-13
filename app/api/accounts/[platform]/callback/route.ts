import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { saveConnectedAccount } from "@/lib/accounts";
import { env } from "@/lib/env";
import { isPlatform } from "@/lib/domain";
import { getPublisher, loadKeys } from "@/lib/social/registry";
import { takeOAuthState } from "@/lib/oauth-state";
import { invalidateDashboards } from "@/lib/live";
import { createSession } from "@/lib/auth";
import { signInWithGoogle } from "@/lib/auth-provider";
import { HttpError } from "@/lib/http";
import { attachReferral } from "@/lib/referral";
import { YouTubePublisher, googleIdentity } from "@/lib/social/youtube";

export const dynamic = "force-dynamic";

/** Step 2: verify state (CSRF), exchange code, store tokens encrypted. */
export async function GET(req: NextRequest, { params }: { params: { platform: string } }) {
  if (!isPlatform(params.platform)) return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  const p = params.platform;
  await loadKeys();
  const pending = takeOAuthState(p, req.nextUrl.searchParams.get("state"));
  if (pending?.mode === "login" && p === "youtube") return googleSignIn(req, pending.returnTo);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL));
  const back = (q: string) => NextResponse.redirect(new URL(`${pending?.returnTo ?? "/accounts"}${(pending?.returnTo ?? "").includes("?") ? "&" : "?"}${q}`, env.APP_URL));
  if (!pending) return back(`connect_error=${p}&reason=state`);
  if (user.role !== "owner") return back(`connect_error=${p}&reason=owner_only`);
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return back(`connect_error=${p}&reason=${encodeURIComponent(req.nextUrl.searchParams.get("error") ?? "denied")}`);
  try {
    const prof = await getPublisher(p).completeConnect(code, `${env.APP_URL}/api/accounts/${p}/callback`, pending.verifier);
    await saveConnectedAccount(user.id, p, prof);
    invalidateDashboards(user.id);
    return back(`connected=${p}`);
  } catch (e) {
    console.error("[oauth callback]", e);
    return back(`connect_error=${p}&reason=${(e as { code?: string }).code === "NO_CHANNEL" ? "no_channel" : "exchange"}`);
  }
}

/** Continue with Google: sign in (or create the studio), then link the YouTube channel if there is one. */
async function googleSignIn(req: NextRequest, returnTo: string) {
  const fail = (reason: string) => NextResponse.redirect(new URL(`/login?google_error=${encodeURIComponent(reason)}`, env.APP_URL));
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return fail(req.nextUrl.searchParams.get("error") ?? "denied");
  const yt = new YouTubePublisher();
  try {
    const tok = await yt.exchange(code, `${env.APP_URL}/api/accounts/youtube/callback`);
    const who = await googleIdentity(tok.access_token);
    if (!who.email || who.email_verified === false) return fail("unverified");
    const user = await signInWithGoogle({ email: who.email, name: who.name, picture: who.picture });
    if (user.created) await attachReferral(user.id).catch((e) => console.error("[referral] attach", e));
    await createSession(user.id);
    const channel = await yt.channelProfile(tok).catch((e) => {
      console.error("[google sign-in] channel", e);
      return undefined;
    });
    if (channel) {
      await saveConnectedAccount(user.id, "youtube", channel);
      invalidateDashboards(user.id);
    }
    const dest = new URL(returnTo, env.APP_URL);
    if (user.created) dest.searchParams.set("welcome", "1");
    dest.searchParams.set(channel ? "connected" : "notice", channel ? "youtube" : channel === null ? "no_channel" : "channel_later");
    return NextResponse.redirect(dest);
  } catch (e) {
    // Waitlist on and this Google account has no invite yet: send them to join the line.
    if (e instanceof HttpError && e.code === "waitlist") return NextResponse.redirect(new URL("/waitlist?from=google", env.APP_URL));
    console.error("[google sign-in]", e);
    return fail("exchange");
  }
}
