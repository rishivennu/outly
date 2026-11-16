import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { APPLE_CALLBACK_PATH, AppleError, appleExchange, appleIdentity, appleName, parkAppleForm, takeAppleForm, takeAppleState } from "@/lib/apple-auth";
import { signInWithApple } from "@/lib/auth-provider";
import { beginSignIn } from "@/lib/otp/two-factor";
import { HttpError, clientIp } from "@/lib/http";
import { attachReferral } from "@/lib/referral";
import { attachSource } from "@/lib/growth/source";
import { captureSignal } from "@/lib/subscriptions/signals";

export const dynamic = "force-dynamic";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" && v.length <= 8192 ? v : null);

/** Step 2a: Apple POSTs here (form_post). Park the answer and bounce to the GET below; see parkAppleForm. */
export async function POST(req: NextRequest) {
  const f = await req.formData().catch(() => null);
  await parkAppleForm({ code: str(f?.get("code") ?? null), state: str(f?.get("state") ?? null), user: str(f?.get("user") ?? null), error: str(f?.get("error") ?? null) });
  return NextResponse.redirect(new URL(APPLE_CALLBACK_PATH, env.APP_URL), 303);
}

/** Step 2b: check the state, swap the code for an ID token, then sign in or create the studio. */
export async function GET(req: NextRequest) {
  const form = await takeAppleForm();
  const pending = await takeAppleState(form?.state ?? null);
  const page = pending?.from === "signup" ? "/signup" : "/login";
  const fail = (reason: string, to = page) => NextResponse.redirect(new URL(`${to}?apple_error=${encodeURIComponent(reason)}`, env.APP_URL));
  if (!form || !pending) return fail("state", "/login");
  if (form.error || !form.code) return fail("denied");
  try {
    const who = await appleIdentity(await appleExchange(form.code), pending.nonce);
    const user = await signInWithApple({ ...who, name: appleName(form.user) }, { adult: req.cookies.get("outlly_adult")?.value === "1" });
    if (user.created) await attachReferral(user.id, clientIp(req)).catch((e) => console.error("[referral] attach", e));
    if (user.created) await attachSource(user.id).catch((e) => console.error("[growth] source", e));
    if (user.created) await captureSignal({ req, userId: user.id, event: "signup" }).catch((e) => console.error("[subs] signup signal", e));
    // Authenticator on: Apple was the first step only. No session until the app code.
    if ((await beginSignIn(user.id, "other", { remember: pending.remember })).twoFactor) {
      const half = new URL("/login", env.APP_URL);
      half.searchParams.set("step", "2fa");
      if (pending.returnTo !== "/home") half.searchParams.set("next", pending.returnTo);
      return NextResponse.redirect(half);
    }
    const dest = new URL(pending.returnTo, env.APP_URL);
    if (user.created) dest.searchParams.set("welcome", "1");
    return NextResponse.redirect(dest);
  } catch (e) {
    if (e instanceof AppleError) {
      console.error("[apple sign-in]", e.reason, e.technical);
      return fail(e.reason);
    }
    if (e instanceof HttpError && e.code === "waitlist") return NextResponse.redirect(new URL("/waitlist?from=apple", env.APP_URL));
    if (e instanceof HttpError && e.code === "maintenance") return fail("maintenance");
    if (e instanceof HttpError && e.code === "age") return fail("age", "/signup");
    if (e instanceof HttpError && (e.code === "no_email" || e.code === "unverified" || e.code === "apple_other")) return fail(e.code);
    console.error("[apple sign-in]", e);
    return fail(/prisma|database|ECONNREFUSED|P10\d\d|P20\d\d/i.test(String((e as Error)?.message)) ? "server" : "exchange");
  }
}
