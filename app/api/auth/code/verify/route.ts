import { z } from "zod";
import { json, route } from "@/lib/http";
import { verifyCode } from "@/lib/otp/service";
import { beginSignIn } from "@/lib/otp/two-factor";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("That email doesn't look quite right").max(200),
  code: z.string().trim().min(1, "Enter the 6-digit code from the email.").max(20),
});

export const POST = route(
  async (req) => {
    const b = schema.parse(await req.json());
    const user = await verifyCode(b.email, b.code);
    return json({ ok: true, ...(await beginSignIn(user.id)) });
  },
  { auth: false, limit: [20, 10 * 60_000] },
);
