import { createSession } from "@/lib/auth";
import { signUp, validTimezone } from "@/lib/auth-provider";
import { clientIp, json, route } from "@/lib/http";
import { signupSchema } from "@/lib/validation";
import { attachReferral } from "@/lib/referral";
import { attachSource } from "@/lib/growth/source";
import { assertMayCreateAccount } from "@/lib/site";

export const POST = route(
  async (req) => {
    const raw = (await req.json()) as Record<string, unknown>;
    const body = signupSchema.parse(raw);
    // Optional: the browser's own time zone, so schedules and weekly reports are right from the first post.
    const timezone = validTimezone(typeof raw.timezone === "string" ? raw.timezone : null);
    // Waitlist on: only invitees (and pending teammates) may create an account. Checked here, not just
    // by the /signup redirect, so a direct API call can't skip the line.
    await assertMayCreateAccount(body.email);
    const user = await signUp(body.name, body.email, body.password, timezone);
    await attachReferral(user.id, clientIp(req)).catch((e) => console.error("[referral] attach", e));
    await attachSource(user.id).catch((e) => console.error("[growth] source", e));
    await createSession(user.id);
    return json({ ok: true });
  },
  { auth: false, limit: [5, 60_000] },
);
