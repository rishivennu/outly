import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { saveConnectedAccount } from "@/lib/accounts";
import { env } from "@/lib/env";
import { isPlatform } from "@/lib/domain";
import { getPublisher, loadKeys } from "@/lib/social/registry";
import { takeOAuthState } from "@/lib/oauth-state";
import { invalidateDashboards } from "@/lib/live";
import { beginSignIn } from "@/lib/otp/two-factor";
import { signInWithGoogle } from "@/lib/auth-provider";
import { HttpError } from "@/lib/http";
import { attachReferral } from "@/lib/referral";
import { attachSource } from "@/lib/growth/source";
import { YouTubePublisher, googleIdentity } from "@/lib/social/youtube";
import { connectDetail, connectReason } from "@/lib/social/connect-reason";

export const dynamic = "force-dynamic";

/** Step 2: verify state (CSRF), exchange code, store tokens encrypted. */
export async function GET(req: NextRequest, { params }: { params: { platform: string } }) {
  if (!isPlatform(params.platform)) return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  const p = params.platform;
  await loadKeys();
  const pending = takeOAuthState(p, req.nextUrl.searchParams.get("state"));
  if (pending?.mode === "login" && p === "youtube") return googleSignIn(req, pending.returnTo);
  const user = await getCurrentUser();
  // A Google sign-in whose state cookie is gone (other tab, expired after 10 min, or started on another
  // domain than APP_URL) used to drop the visitor on /login with no word of what happened. Say it.
  if (!user && !pending && p === "youtube") return NextResponse.redirect(new URL(`/login?google_error=${req.nextUrl.searchParams.get("error") === "access_denied" ? "access_denied" : "state"}`, env.APP_URL));
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
    return back(`connected=${p}${prof.declined?.length ? "&notice=dm_scope" : ""}`);
  } catch (e) {
    console.error("[oauth callback]", p, e, (e as { technical?: string }).technical ?? "");
    const res = back(`connect_error=${p}&reason=${connectReason(e)}`);
    // The exact step and the platform's own words, for the Accounts page (1031e). A cookie, not the URL,
    // so a crafted link can't put words in our mouth; it lives two minutes and the page deletes it.
    res.cookies.set("outlly-connect-detail", connectDetail(e), { path: "/", maxAge: 120, sameSite: "lax", secure: env.APP_URL.startsWith("https"), httpOnly: false });
    return res;
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
    if (user.created) await attachSource(user.id).catch((e) => console.error("[growth] source", e));
    // Authenticator on: Google was the first step only. No session (and no channel link) until the app code.
    if ((await beginSignIn(user.id)).twoFactor) {
      const half = new URL("/login", env.APP_URL);
      half.searchParams.set("step", "2fa");
      if (returnTo && returnTo !== "/home") half.searchParams.set("next", returnTo);
      return NextResponse.redirect(half);
    }
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
    // Maintenance: members still get in (they already have an account), but no new account is made.
    if (e instanceof HttpError && e.code === "maintenance") return fail("maintenance");
    console.error("[google sign-in]", e, (e as { technical?: string }).technical ?? "");
    return fail(googleReason(e));
  }
}

/**
 * Turn Google's token-endpoint answer into a reason the login page can explain, so the screen says
 * which setting is wrong instead of a generic "couldn't finish the handshake".
 */
function googleReason(e: unknown) {
  const t = `${(e as { technical?: string })?.technical ?? ""} ${(e as Error)?.message ?? ""}`;
  if (/invalid_client|unauthorized_client/i.test(t)) return "config"; // client ID / secret pair wrong or for another project
  if (/redirect_uri_mismatch/i.test(t)) return "redirect";
  if (/invalid_grant/i.test(t)) return "state"; // code already used or expired: start again
  if (/prisma|database|ECONNREFUSED|P10\d\d|P20\d\d/i.test(t)) return "server";
  return "exchange";
}

