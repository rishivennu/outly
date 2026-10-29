import { z } from "zod";
import { json, route } from "@/lib/http";
import { challengeOptions, clearChallenge, completeSignIn } from "@/lib/otp/two-factor";

const schema = z.object({
  code: z.string().trim().min(1, "Enter the code from your authenticator app.").max(40),
  via: z.enum(["app", "whatsapp"]).optional(),
});

/** What the second step can offer besides the app (a masked WhatsApp number, or nothing). */
export const GET = route(async () => json(await challengeOptions()), { auth: false, limit: [30, 10 * 60_000] });

/** Second step of sign-in: authenticator code, a recovery code, or a WhatsApp code, against the halfway cookie. */
export const POST = route(
  async (req) => {
    const { code, via } = schema.parse(await req.json());
    return json({ ok: true, ...(await completeSignIn(code, via)) });
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
