import { z } from "zod";
import { signInWithGoogle } from "@/lib/auth-provider";
import { googleOneTapIdentity } from "@/lib/google-one-tap";
import { HttpError, clientIp, json, route } from "@/lib/http";
import { beginSignIn } from "@/lib/otp/two-factor";
import { loadKeys } from "@/lib/social/registry";
import { attachReferral } from "@/lib/referral";
import { attachSource } from "@/lib/growth/source";
import { captureSignal } from "@/lib/subscriptions/signals";

const schema = z.object({
  credential: z.string().min(20).max(4096),
  remember: z.boolean().optional(),
  adult: z.boolean().optional(),
});

/**
 * Google One Tap (lib/google-one-tap.ts): the ID token Google handed the page, checked and turned into a session.
 * Same outcomes as Continue with Google, as JSON for the form: { ok, created, twoFactor } or { redirect } for the
 * waitlist, and the known google_error reasons as the error code (age, unverified, maintenance, exchange).
 * The YouTube channel is not linked here: One Tap grants no YouTube scope, Accounts does that later.
 */
export const POST = route(
  async (req) => {
    const body = schema.parse(await req.json());
    await loadKeys();
    const who = await googleOneTapIdentity(body.credential);
    if (!who.emailVerified) throw new HttpError(401, "That Google account doesn't have a verified email, so we can't sign you in with it.", "unverified");
    const adult = body.adult === true || req.cookies.get("outlly_adult")?.value === "1";
    let user: Awaited<ReturnType<typeof signInWithGoogle>>;
    try {
      user = await signInWithGoogle({ email: who.email, name: who.name, picture: who.picture }, { adult });
    } catch (e) {
      if (e instanceof HttpError && e.code === "waitlist") return json({ ok: false, redirect: "/waitlist?from=google" });
      throw e;
    }
    if (user.created) await attachReferral(user.id, clientIp(req)).catch((e) => console.error("[referral] attach", e));
    if (user.created) await attachSource(user.id).catch((e) => console.error("[growth] source", e));
    if (user.created) await captureSignal({ req, userId: user.id, event: "signup" }).catch((e) => console.error("[subs] signup signal", e));
    // Authenticator on: Google was the first step only. The form shows the app-code step next.
    const step = await beginSignIn(user.id, "other", { remember: body.remember });
    return json({ ok: true, created: user.created, twoFactor: step.twoFactor });
  },
  { auth: false, limit: [10, 60_000] },
);
