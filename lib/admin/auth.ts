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

/** First run: create the super admin the owner asked for (admin / 1214). The console nags until it is changed. */
export async function ensureSuperAdmin() {
  if ((await db.adminUser.count()) > 0) return;
  await db.adminUser.create({ data: { login: DEFAULT_LOGIN, name: "Super admin", role: "super", passwordHash: await bcrypt.hash(DEFAULT_PASSWORD, 11) } }).catch(() => {});
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

export async function verifyAdminLogin(login: string, password: string) {
  await ensureSuperAdmin();
  const a = await db.adminUser.findUnique({ where: { login: login.trim().toLowerCase() } });
  // compare against a dummy hash when the login is unknown, so timing does not reveal valid logins
  const ok = await bcrypt.compare(password, a?.passwordHash ?? (DUMMY ??= await bcrypt.hash("not-a-password", 11)));
  if (!a || !ok || !a.active) return null;
  await db.adminUser.update({ where: { id: a.id }, data: { lastLoginAt: new Date() } });
  return a;
}

export const hashAdminPassword = (pw: string) => bcrypt.hash(pw, 11);
export const checkAdminPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function allowed(a: AdminSession | null, area: AdminArea) {
  return !!a && can(a.role, area);
}
