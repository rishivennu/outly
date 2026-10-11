import "server-only";
import { db } from "./db";
import { env } from "./env";
import { hashPassword, verifyPassword } from "./auth";
import { HttpError } from "./http";
import { sbAuth, SupabaseError, supabaseConfigured } from "./supabase/server";

/**
 * Identity lives in Supabase Auth (passwords never touch our DB); our `User` row holds the profile and is
 * linked by `authId`. With AUTH_PROVIDER=local (offline dev) we fall back to bcrypt.
 */
const useSupabase = () => env.AUTH_PROVIDER === "supabase" && supabaseConfigured();

export async function signUp(name: string, email: string, password: string) {
  email = email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new HttpError(409, "That email already has a studio. Try signing in.");
  if (!useSupabase()) {
    return db.user.create({ data: { name, email, passwordHash: await hashPassword(password) }, select: { id: true } });
  }
  try {
    const u = await sbAuth.createUser(email, password, name);
    return db.user.create({ data: { name, email, authId: u.id }, select: { id: true } });
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
    const u = await db.user.create({ data: { email, name: s.user.user_metadata?.name ?? email.split("@")[0], authId: s.user.id } });
    return { id: u.id };
  } catch (e) {
    if (!(e instanceof SupabaseError) || e.status !== 400) throw e;
    // One-time migration: a pre-Supabase local account signs in with its old password.
    if (local && !local.authId && local.passwordHash && (await verifyPassword(password, local.passwordHash))) {
      const existing = await sbAuth.findByEmail(email);
      const sbUser = existing ? await sbAuth.updatePassword(existing.id, password) : await sbAuth.createUser(email, password, local.name);
      await db.user.update({ where: { id: local.id }, data: { authId: sbUser.id, passwordHash: null } });
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
  const u = await db.user.create({ data: { email, name: who.name?.trim() || email.split("@")[0], avatar: who.picture ?? null }, select: { id: true } });
  return { id: u.id, created: true };
}
