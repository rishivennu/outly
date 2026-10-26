import { signIn } from "@/lib/auth-provider";
import { HttpError, json, route } from "@/lib/http";
import { isLimited, limitShared } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation";
import { beginSignIn } from "@/lib/otp/two-factor";

const LOGIN_FAILS = 20;
const LOGIN_WINDOW = 60 * 60_000;

export const POST = route(
  async (req) => {
    const body = loginSchema.parse(await req.json());
    // Per account as well as per IP (1027), like admin login: rotating IPs can't keep guessing one password.
    // Only failures count, so the real owner signing in never uses up their own allowance.
    const key = `login-user:${body.email.toLowerCase()}`;
    const tooMany = () => new HttpError(429, "Too many sign-in attempts for this account. Try again in a while, or sign in with an email code.", "RATE_LIMITED");
    if (isLimited(key, LOGIN_FAILS, LOGIN_WINDOW)) throw tooMany();
    // Same message for unknown email and wrong password, so the endpoint can't be used to discover accounts.
    let user: Awaited<ReturnType<typeof signIn>>;
    try {
      user = await signIn(body.email, body.password);
    } catch (e) {
      if (!(await limitShared(key, LOGIN_FAILS, LOGIN_WINDOW)).ok) throw tooMany();
      throw e;
    }
    // With an authenticator turned on this sets the halfway cookie, and the form asks for the app code next.
    return json({ ok: true, ...(await beginSignIn(user.id)) });
  },
  { auth: false, limit: [10, 60_000] },
);
