import { z } from "zod";
import { json, route } from "@/lib/http";
import { issueCode } from "@/lib/otp/service";

const schema = z.object({ email: z.string().trim().toLowerCase().email("That email doesn't look quite right").max(200) });

/** Email me a sign-in code. Same answer whether or not the address has an account. */
export const POST = route(
  async (req) => {
    const { email } = schema.parse(await req.json());
    await issueCode(email);
    return json({ ok: true });
  },
  { auth: false, limit: [10, 10 * 60_000] },
);
