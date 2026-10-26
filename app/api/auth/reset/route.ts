import { z } from "zod";
import { json, route } from "@/lib/http";
import { issueCode, verifyCode } from "@/lib/otp/service";
import { beginSignIn } from "@/lib/otp/two-factor";
import { setPassword } from "@/lib/auth-provider";

const email = z.string().trim().toLowerCase().email("That email doesn't look quite right").max(200);
const schema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("send"), email }),
  z.object({
    step: z.literal("confirm"),
    email,
    code: z.string().trim().min(1, "Enter the 6-digit code from the email.").max(20),
    password: z.string().min(8, "Use at least 8 characters").max(200),
  }),
]);

/**
 * Forgot password, in two steps on one route:
 * - send: emails a reset code. Same answer whether or not the address has an account.
 * - confirm: checks the code (single use, 5 tries, 10 minutes), sets the new password, signs out every
 *   other device and signs this one in (through 2FA when the studio has it on).
 */
export const POST = route(
  async (req) => {
    const b = schema.parse(await req.json());
    if (b.step === "send") {
      await issueCode(b.email, "reset");
      return json({ ok: true });
    }
    const user = await verifyCode(b.email, b.code, "reset");
    await setPassword(user.id, b.password);
    return json({ ok: true, ...(await beginSignIn(user.id)) });
  },
  { auth: false, limit: [10, 10 * 60_000] },
);
