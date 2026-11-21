import { z } from "zod";
import { db } from "@/lib/db";
import { realUserId, reissueSession } from "@/lib/auth";
import { setPassword, signIn } from "@/lib/auth-provider";
import { HttpError, json, route } from "@/lib/http";
import { signupSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const Body = z.object({ current: z.string().min(1, "Enter your current password.").max(200), next: z.string().max(10_000) });

const weak = (message: string, issues: unknown[]) => new HttpError(400, message, "WEAK_PASSWORD", { issues });

/**
 * R1294: change the password with the current one (the app's Security card; the web keeps Forgot password). Always the
 * person signed in, never the workspace owner. Every other device is signed out; this one is re-issued and stays in.
 */
export const POST = route(
  async (req, { user }) => {
    const { current, next } = Body.parse(await req.json());
    const rule = signupSchema.shape.password.safeParse(next);
    if (!rule.success) throw weak(rule.error.issues[0]?.message ?? "Use at least 8 characters", rule.error.issues);
    const me = realUserId(user);
    const u = await db.user.findUnique({ where: { id: me }, select: { email: true, passwordHash: true, authId: true } });
    if (!u) throw new HttpError(401, "Please sign in again.", "UNAUTHENTICATED");
    if (!u.passwordHash && !u.authId)
      throw new HttpError(409, "This account signs in with Google or WhatsApp and has no password yet. Use Forgot password to add one.", "NO_PASSWORD");
    try {
      await signIn(u.email, current);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) throw new HttpError(403, "That isn't your current password.", "BAD_CURRENT_PASSWORD");
      throw e;
    }
    try {
      await setPassword(me, next);
    } catch (e) {
      if (e instanceof HttpError && e.status === 422) throw weak(e.message, []);
      throw e;
    }
    await reissueSession(me);
    return json({ ok: true });
  },
  { limit: [5, 15 * 60_000] },
);
