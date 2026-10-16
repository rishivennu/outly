import "server-only";
import { db } from "./db";
import { env } from "./env";
import { hashPassword, revokeAllSessions, verifyPassword } from "./auth";
import { HttpError } from "./http";
import { assertMayCreateAccount } from "./site";
import { sbAuth, SupabaseError, supabaseConfigured } from "./supabase/server";
import { cookies } from "next/headers";

/** Cookie the browser sets (client-side) before a Google redirect, since it can't post a body there. */
export const TZ_COOKIE = "outlly_tz";

/** A time zone we can actually format with. Anything else is ignored rather than stored. */
export function validTimezone(tz: string | null | undefined): string | null {
  const v = (tz ?? "").trim();
  if (!v || v.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return v;
  } catch {
    return null;
  }
}

/** Only used when a row is created: an existing studio keeps whatever the creator chose in settings. */
function tzData(tz?: string | null) {
  const v = validTimezone(tz);
  return v ? { timezone: v } : {};
}

function cookieTimezone() {
  try {
    return validTimezone(cookies().get(TZ_COOKIE)?.value);
  } catch {
    return null; // outside a request scope (worker, script)
  }
}

/**
 * Identity lives in Supabase Auth (passwords never touch our DB); our `User` row holds the profile and is
 * linked by `authId`. With AUTH_PROVIDER=local (offline dev) we fall back to bcrypt.
 */
const useSupabase = () => env.AUTH_PROVIDER === "supabase" && supabaseConfigured();

export async function signUp(name: string, email: string, password: string, timezone?: string | null) {
  email = email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new HttpError(409, "That email already has a studio. Try signing in.");
  if (!useSupabase()) {
    return db.user.create({ data: { name, email, passwordHash: await hashPassword(password), ...tzData(timezone) }, select: { id: true } });
  }
  try {
    const u = await sbAuth.createUser(email, password, name);
    return db.user.create({ data: { name, email, authId: u.id, ...tzData(timezone) }, select: { id: true } });
  } catch (e) {
    if (e instanceof SupabaseError && e.status === 422) {
      const msg = String((e.body as { msg?: string; message?: string })?.msg ?? (e.body as { message?: string })?.message ?? "");
      if (/already|exists|registered/i.test(msg)) throw new HttpError(409, "That email already has a studio. Try signing in.");
      if (/password/i.test(msg)) throw new HttpError(422, "Pick a stronger password (at least 8 characters).");
    }
    throw e;
  }
}

export async function signIn(email: string, password: string) {
  email = email.toLowerCase();
  const local = await db.user.findUnique({ where: { email } });
  const wrong = new HttpError(401, "That email and password don't match.");
  if (local && !local.passwordHash && !local.authId) throw new HttpError(401, "This studio signs in with Google. Use Continue with Google.");
  if (!useSupabase()) {
    if (!local?.passwordHash || !(await verifyPassword(password, local.passwordHash))) throw wrong;
    return { id: local.id };
  }
  try {
    const s = await sbAuth.signIn(email, password);
    if (local) {
      if (local.authId !== s.user.id) await db.user.update({ where: { id: local.id }, data: { authId: s.user.id, passwordHash: null } });
      return { id: local.id };
    }
    // Account exists in Supabase but not here yet (e.g. created in the dashboard): create the profile.
    // That is a new account, so the waitlist applies (Supabase may allow public sign-ups).
    await assertMayCreateAccount(email);
    const u = await db.user.create({ data: { email, name: s.user.user_metadata?.name ?? email.split("@")[0], authId: s.user.id } });
    return { id: u.id };
  } catch (e) {
    if (!(e instanceof SupabaseError) || e.status !== 400) throw e;
    // One-time migration: a pre-Supabase local account signs in with its old password.
    if (local && !local.authId && local.passwordHash && (await verifyPassword(password, local.passwordHash))) {
      const existing = await sbAuth.findByEmail(email);
      const sbUser = existing ? await sbAuth.updatePassword(existing.id, password) : await sbAuth.createUser(email, password, local.name);
      await db.user.update({ where: { id: local.id }, data: { authId: sbUser.id, passwordHash: null } });
      // The credential moved, so every cookie issued against the old one stops working. The caller
      // signs this device back in straight away (beginSignIn), so only other devices are kicked out.
      await revokeAllSessions(local.id);
      return { id: local.id };
    }
    throw wrong;
  }
}

/**
 * Continue with Google. Google has already verified the address, so an existing studio with the
 * same email is signed in, and a new one is created otherwise. Password sign-in stays untouched.
 */
export async function signInWithGoogle(who: { email: string; name?: string; picture?: string }) {
  const email = who.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { id: existing.id, created: false };
  await assertMayCreateAccount(email);
  // The Google callback carries no body, so the browser leaves its time zone in a cookie before redirecting.
  const u = await db.user.create({ data: { email, name: who.name?.trim() || email.split("@")[0], avatar: who.picture ?? null, ...tzData(cookieTimezone()) }, select: { id: true } });
  return { id: u.id, created: true };
}
