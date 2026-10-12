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

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
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

export async function readSessionUserId(): Promise<string | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

const USER_SELECT = { id: true, name: true, email: true, avatar: true, timezone: true, createdAt: true } as const;

/**
 * Current user, cached per request. Never returns secrets.
 * Inside a team workspace (cookie ol_ws + an active seat) this IS the workspace owner, so every existing query
 * scoped by user.id just works; `actor` is the real person signed in and `role` what they may do.
 */
export const getCurrentUser = cache(async () => {
  const id = await readSessionUserId();
  if (!id) return null;
  const me = await db.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!me) return null;
  const ws = cookies().get(WS_COOKIE)?.value;
  if (ws && ws !== id) {
    const seat = await db.teamMember.findFirst({ where: { ownerId: ws, userId: id, status: "active" }, select: { role: true, owner: { select: USER_SELECT } } });
    if (seat && (TEAM_ROLES as readonly string[]).includes(seat.role))
      return { ...seat.owner, actor: { id: me.id, name: me.name, email: me.email } as Actor | null, role: seat.role as WorkspaceRole };
  }
  return { ...me, actor: null as Actor | null, role: "owner" as WorkspaceRole };
});

export type Actor = { id: string; name: string; email: string };
/** The person actually signed in, whichever workspace they're in. */
export const realUserId = (u: { id: string; actor: Actor | null }) => u.actor?.id ?? u.id;

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
