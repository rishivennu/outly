import { createSession } from "@/lib/auth";
import { signUp } from "@/lib/auth-provider";
import { json, route } from "@/lib/http";
import { signupSchema } from "@/lib/validation";

export const POST = route(
  async (req) => {
    const body = signupSchema.parse(await req.json());
    const user = await signUp(body.name, body.email, body.password);
    await createSession(user.id);
    return json({ ok: true });
  },
  { auth: false, limit: [5, 60_000] },
);
