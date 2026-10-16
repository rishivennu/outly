import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cache } from "react";
import { db } from "./db";
import { env } from "./env";

import { SESSION_COOKIE } from "./session-cookie";
import { TEAM_ROLES, WS_COOKIE, type WorkspaceRole } from "./team/roles";
export { SESSION_COOKIE };
const secret = new TextEncoder().encode(env.AUTH_SECRET);
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 11);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

/**
 * Sign in. The JWT carries the user's `tokenVersion` as `v`, so "sign out everywhere" (or a password
 * change) can invalidate every existing cookie by bumping one integer — no session table needed.
 */
export async function createSession(userId: string) {
  const v = (await db.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } }))?.tokenVersion ?? 0;
  const token = await new SignJWT({ sub: userId, v })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret);
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export function destroySession() {
  cookies().delete(SESSION_COOKIE);
  cookies().delete("outlly_in"); // readable signed-in hint kept by middleware
}

/** Cookie contents, signature-checked only. Tokens issued before `v` existed read as v=0. */
async function readSessionClaims(): Promise<{ id: string; v: number } | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return { id: payload.sub, v: typeof payload.v === "number" ? payload.v : 0 };
  } catch {
    return null;
  }
}

/** Signed-in user id, revocation included (one cheap query). Null once the token version is stale. */
export async function readSessionUserId(): Promise<string | null> {
  const claims = await readSessionClaims();
  if (!claims) return null;
  const u = await db.user.findUnique({ where: { id: claims.id }, select: { tokenVersion: true } });
  return u && u.tokenVersion === claims.v ? claims.id : null;
}

/** Invalidate every session this person has anywhere. Call after logout-everywhere or a password change. */
export async function revokeAllSessions(userId: string) {
  await db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}

const USER_SELECT = { id: true, name: true, email: true, avatar: true, timezone: true, createdAt: true } as const;

/**
 * Current user, cached per request. Never returns secrets.
 * Inside a team workspace (cookie ol_ws + an active seat) this IS the workspace owner, so every existing query
 * scoped by user.id just works; `actor` is the real person signed in and `role` what they may do.
 */
export const getCurrentUser = cache(async () => {
  const claims = await readSessionClaims();
  if (!claims) return null;
  const id = claims.id;
  const found = await db.user.findUnique({ where: { id }, select: { ...USER_SELECT, tokenVersion: true } });
  // Revoked elsewhere ("sign out everywhere", password change): the cookie verifies but is one version behind.
  if (!found || found.tokenVersion !== claims.v) return null;
  const { tokenVersion: _v, ...me } = found;
  const ws = cookies().get(WS_COOKIE)?.value;
  if (ws && ws !== id) {
    const seat = await db.teamMember.findFirst({ where: { ownerId: ws, userId: id, status: "active" }, select: { role: true, owner: { select: USER_SELECT } } });
    if (seat && (TEAM_ROLES as readonly string[]).includes(seat.role))
      return { ...seat.owner, joinedAt: me.createdAt, actor: { id: me.id, name: me.name, email: me.email } as Actor | null, role: seat.role as WorkspaceRole };
  }
  return { ...me, joinedAt: me.createdAt, actor: null as Actor | null, role: "owner" as WorkspaceRole };
});

export type Actor = { id: string; name: string; email: string };
/** The person actually signed in, whichever workspace they're in. */
export const realUserId = (u: { id: string; actor: Actor | null }) => u.actor?.id ?? u.id;

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
