import "server-only";
import { cache } from "react";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { env } from "../env";
import type { AdminRole, AdminArea } from "./perms";
import { can } from "./perms";

export const ADMIN_COOKIE = "outly_admin";
const secret = new TextEncoder().encode(env.AUTH_SECRET + ":admin");
const TTL_S = 8 * 60 * 60;
export const DEFAULT_LOGIN = "admin";
const DEFAULT_PASSWORD = "1214";
let DUMMY: string | undefined;

const PROD = process.env.NODE_ENV === "production";
/** Strong bootstrap password from the environment (production must set one; 12+ characters). */
const bootstrapPassword = () => {
  const pw = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim() ?? "";
  return pw.length >= 12 ? pw : "";
};

/**
 * First run: create the super admin.
 * - Dev: admin / 1214 (the console nags until it is changed).
 * - Production: only with ADMIN_BOOTSTRAP_PASSWORD (12+ chars). If an admin is still on the
 *   4-digit starter password, it is rotated to the bootstrap password, so a live deploy that was
 *   created with 1214 is closed the moment the env var is set.
 */
let rotateChecked = false;
export async function ensureSuperAdmin() {
  const boot = bootstrapPassword();
  if ((await db.adminUser.count()) > 0) {
    if (PROD && boot && !rotateChecked) {
      rotateChecked = true;
      const def = await db.adminUser.findUnique({ where: { login: DEFAULT_LOGIN } });
      if (def && (await bcrypt.compare(DEFAULT_PASSWORD, def.passwordHash)))
        await db.adminUser.update({ where: { id: def.id }, data: { passwordHash: await bcrypt.hash(boot, 11) } }).catch(() => {});
    }
    return;
  }
  if (PROD && !boot) {
    console.error("[admin] No admin exists. Set ADMIN_BOOTSTRAP_PASSWORD (12+ characters) to create the first super admin.");
    return;
  }
  await db.adminUser.create({ data: { login: DEFAULT_LOGIN, name: "Super admin", role: "super", passwordHash: await bcrypt.hash(boot || DEFAULT_PASSWORD, 11) } }).catch(() => {});
}

/** True while this admin still signs in with the starter password. */
// bcrypt is deliberately slow (~0.2 s). The answer only changes when the hash changes, so remember it
// per hash instead of paying that on every admin page the layout renders.
const weakByHash = new Map<string, boolean>();
export async function usingDefaultPassword(adminId: string) {
  const a = await db.adminUser.findUnique({ where: { id: adminId }, select: { passwordHash: true } });
  if (!a) return false;
  const hit = weakByHash.get(a.passwordHash);
  if (hit !== undefined) return hit;
  const weak = await bcrypt.compare(DEFAULT_PASSWORD, a.passwordHash);
  if (weakByHash.size > 200) weakByHash.clear();
  weakByHash.set(a.passwordHash, weak);
  return weak;
}

/** Fingerprint of the password hash: changing the password invalidates every older session. */
const fp = (hash: string) => createHash("sha256").update(hash).digest("base64url").slice(0, 16);

export async function createAdminSession(a: { id: string; role: string; passwordHash: string }) {
  const token = await new SignJWT({ role: a.role, fp: fp(a.passwordHash) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(a.id)
    .setIssuedAt()
    .setExpirationTime(`${TTL_S}s`)
    .sign(secret);
  cookies().set(ADMIN_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: TTL_S });
}

export function destroyAdminSession() {
  cookies().delete(ADMIN_COOKIE);
}

export type AdminSession = { id: string; name: string; login: string; role: AdminRole };

export const getAdmin = cache(async (): Promise<AdminSession | null> => {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    const a = await db.adminUser.findUnique({ where: { id: String(payload.sub) } });
    if (!a || !a.active || payload.fp !== fp(a.passwordHash)) return null;
    return { id: a.id, name: a.name, login: a.login, role: a.role as AdminRole };
  } catch {
    return null;
  }
});

/** True when the request carries a validly signed admin cookie. No database read, so it still works
 * while the database is down (used by /api/health to decide who sees diagnostics). */
export async function hasAdminCookie() {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export async function verifyAdminLogin(login: string, password: string) {
  await ensureSuperAdmin();
  const a = await db.adminUser.findUnique({ where: { login: login.trim().toLowerCase() } });
  // compare against a dummy hash when the login is unknown, so timing does not reveal valid logins
  const ok = await bcrypt.compare(password, a?.passwordHash ?? (DUMMY ??= await bcrypt.hash("not-a-password", 11)));
  if (!a || !ok || !a.active) return null;
  // Never accept the 4-digit starter password on a live site: it falls to a few thousand guesses.
  if (PROD && password === DEFAULT_PASSWORD) return null;
  await db.adminUser.update({ where: { id: a.id }, data: { lastLoginAt: new Date() } });
  return a;
}

export const hashAdminPassword = (pw: string) => bcrypt.hash(pw, 11);
export const checkAdminPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function allowed(a: AdminSession | null, area: AdminArea) {
  return !!a && can(a.role, area);
}
