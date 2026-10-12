import { createSession } from "@/lib/auth";
import { signUp } from "@/lib/auth-provider";
import { json, route } from "@/lib/http";
import { signupSchema } from "@/lib/validation";
import { attachReferral } from "@/lib/referral";
import { assertMayCreateAccount } from "@/lib/site";

export const POST = route(
  async (req) => {
    const body = signupSchema.parse(await req.json());
    // Waitlist on: only invitees (and pending teammates) may create an account. Checked here, not just
    // by the /signup redirect, so a direct API call can't skip the line.
    await assertMayCreateAccount(body.email);
    const user = await signUp(body.name, body.email, body.password);
    await attachReferral(user.id).catch((e) => console.error("[referral] attach", e));
    await createSession(user.id);
    return json({ ok: true });
  },
  { auth: false, limit: [5, 60_000] },
);
