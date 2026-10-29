import { z } from "zod";
import { json, route } from "@/lib/http";
import { issueCode } from "@/lib/otp/service";
import { issuePhoneLogin } from "@/lib/otp/whatsapp";

const schema = z.union([
  z.object({ email: z.string().trim().toLowerCase().email("That email doesn't look quite right").max(200) }),
  z.object({ phone: z.string().trim().min(6, "Enter your WhatsApp number").max(32) }),
]);

/** Send me a sign-in code, by email or (when it's switched on) WhatsApp. Same answer whether or not there's an account. */
export const POST = route(
  async (req) => {
    const b = schema.parse(await req.json());
    if ("phone" in b) await issuePhoneLogin(b.phone);
    else await issueCode(b.email);
    return json({ ok: true });
  },
  { auth: false, limit: [10, 10 * 60_000] },
);
