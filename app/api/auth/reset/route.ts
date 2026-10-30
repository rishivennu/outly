import { z } from "zod";
import { json, route } from "@/lib/http";
import { issueCode, verifyCode } from "@/lib/otp/service";
import { issuePhoneLogin, verifyPhoneLogin } from "@/lib/otp/whatsapp";
import { setPassword } from "@/lib/auth-provider";
import { db } from "@/lib/db";

const email = z.string().trim().toLowerCase().email("That email doesn't look quite right").max(200);
const phone = z.string().trim().min(6, "Enter your WhatsApp number").max(32);
const step = z.object({ step: z.enum(["send", "confirm"]) });
const who = z.union([z.object({ email }), z.object({ phone })]);
const confirm = z.object({
  code: z.string().trim().min(1, "Enter the 6-digit code.").max(20),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

/**
 * Forgot password, in two steps on one route, by email or (when it's switched on) WhatsApp (1060):
 * - send: sends a reset code. Same answer whether or not the address or number has an account.
 * - confirm: checks the code (single use, 5 tries, 10 minutes), sets the new password and signs out every
 *   device. It does not sign in: the page says it worked and goes back to sign in, so the new password is
 *   used once straight away (and 2FA applies there as usual). After an EMAIL reset the address comes back so
 *   the sign-in form can be filled in (only the inbox's owner gets here). After a WhatsApp reset it doesn't:
 *   numbers get recycled, and the next owner of a number mustn't learn the old owner's email.
 */
export const POST = route(
  async (req) => {
    const raw = await req.json();
    const s = step.parse(raw).step;
    const to = who.parse(raw);
    if (s === "send") {
      if ("phone" in to) await issuePhoneLogin(to.phone, "reset");
      else await issueCode(to.email, "reset");
      return json({ ok: true });
    }
    const b = confirm.parse(raw);
    const user = "phone" in to ? await verifyPhoneLogin(to.phone, b.code, "reset") : await verifyCode(to.email, b.code, "reset");
    await setPassword(user.id, b.password);
    if ("phone" in to) return json({ ok: true, email: null });
    const u = await db.user.findUnique({ where: { id: user.id }, select: { email: true } });
    return json({ ok: true, email: u?.email ?? null });
  },
  { auth: false, limit: [10, 10 * 60_000] },
);
