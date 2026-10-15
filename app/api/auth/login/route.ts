import { signIn } from "@/lib/auth-provider";
import { json, route } from "@/lib/http";
import { loginSchema } from "@/lib/validation";
import { beginSignIn } from "@/lib/otp/two-factor";

export const POST = route(
  async (req) => {
    const body = loginSchema.parse(await req.json());
    // Same message for unknown email and wrong password, so the endpoint can't be used to discover accounts.
    const user = await signIn(body.email, body.password);
    // With an authenticator turned on this sets the halfway cookie, and the form asks for the app code next.
    return json({ ok: true, ...(await beginSignIn(user.id)) });
  },
  { auth: false, limit: [10, 60_000] },
);
