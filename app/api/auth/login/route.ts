import { createSession } from "@/lib/auth";
import { signIn } from "@/lib/auth-provider";
import { json, route } from "@/lib/http";
import { loginSchema } from "@/lib/validation";

export const POST = route(
  async (req) => {
    const body = loginSchema.parse(await req.json());
    // Same message for unknown email and wrong password, so the endpoint can't be used to discover accounts.
    const user = await signIn(body.email, body.password);
    await createSession(user.id);
    return json({ ok: true });
  },
  { auth: false, limit: [10, 60_000] },
);
