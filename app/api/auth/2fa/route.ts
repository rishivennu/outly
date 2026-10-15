import { z } from "zod";
import { json, route } from "@/lib/http";
import { clearChallenge, completeSignIn } from "@/lib/otp/two-factor";

const schema = z.object({ code: z.string().trim().min(1, "Enter the code from your authenticator app.").max(40) });

/** Second step of sign-in: authenticator code or a recovery code, against the halfway cookie. */
export const POST = route(
  async (req) => {
    const { code } = schema.parse(await req.json());
    return json({ ok: true, ...(await completeSignIn(code)) });
  },
  { auth: false, limit: [20, 10 * 60_000] },
);

/** "Start over": forget the halfway sign-in. */
export const DELETE = route(
  async () => {
    clearChallenge();
    return json({ ok: true });
  },
  { auth: false, limit: [30, 10 * 60_000] },
);
