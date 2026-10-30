import { z } from "zod";
import { json, route } from "@/lib/http";
import { verifyCode } from "@/lib/otp/service";
import { verifyPhoneLogin } from "@/lib/otp/whatsapp";
import { beginSignIn } from "@/lib/otp/two-factor";

const code = z.string().trim().min(1, "Enter the 6-digit code.").max(20);
const schema = z.union([
  z.object({ email: z.string().trim().toLowerCase().email("That email doesn't look quite right").max(200), code, remember: z.boolean().optional() }),
  z.object({ phone: z.string().trim().min(6, "Enter your WhatsApp number").max(32), code, remember: z.boolean().optional() }),
]);

export const POST = route(
  async (req) => {
    const b = schema.parse(await req.json());
    if ("phone" in b) {
      const user = await verifyPhoneLogin(b.phone, b.code);
      return json({ ok: true, ...(await beginSignIn(user.id, "whatsapp", { remember: b.remember })) });
    }
    const user = await verifyCode(b.email, b.code);
    return json({ ok: true, ...(await beginSignIn(user.id, "other", { remember: b.remember })) });
  },
  { auth: false, limit: [20, 10 * 60_000] },
);
