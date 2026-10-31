import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cache } from "react";
import { db } from "./db";
import { env } from "./env";

import { SESSION_COOKIE } from "./session-cookie";
import { TEAM_ROLES, WS_COOKIE, type WorkspaceRole } from "./team/roles";
import { parseScope, type Scope } from "./profiles-core";
import { deviceLabel, ipPlace, placeLabel } from "./geo";
import { NATIVE_CLIENT_HEADER, parseNativeClient } from "./native-client";
export { SESSION_COOKIE };
const secret = new TextEncoder().encode(env.AUTH_SECRET);
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days
const SHORT_AGE = 60 * 60 * 24; // a sign-in that chose "Don't remember this device"

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
/** Max sessions kept per person; the least recently used beyond this are signed out. */
const MAX_SESSIONS = 30;

/**
 * Opens (or, for a renewal, extends) the Active sessions row this cookie will carry as `sid` (1080).
 * Best effort: if it can't be written the sign-in still works, as a cookie without `sid`.
 */
async function openSessionRow(userId: string, ageS: number, sid?: string): Promise<string | undefined> {
  const expiresAt = new Date(Date.now() + ageS * 1000);
  try {
    if (sid) {
      const r = await db.userSession.updateMany({ where: { id: sid, userId }, data: { expiresAt, lastSeenAt: new Date() } });
      if (r.count) return sid;
    }
    let h: Headers | null = null;
    try {
      h = headers() as unknown as Headers;
    } catch {
      /* outside a request (tests, scripts) */
    }
    const native = parseNativeClient(h?.get(NATIVE_CLIENT_HEADER));
    const label = native ? `Outlly app on ${native.platform === "ios" ? "iPhone or iPad" : "Android"}` : deviceLabel(h?.get("user-agent"));
    const place = h ? placeLabel(ipPlace((n) => h!.get(n))) : null;
    const row = await db.userSession.create({ data: { userId, label, place, app: !!native, expiresAt }, select: { id: true } });
    // Housekeeping on the way in: drop expired rows and anything past the cap.
    await db.userSession.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
    const extra = await db.userSession.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" }, skip: MAX_SESSIONS, select: { id: true } });
    if (extra.length) await db.userSession.deleteMany({ where: { id: { in: extra.map((x) => x.id) } } });
    return row.id;
  } catch (e) {
    console.error("[sessions] couldn't record the session", (e as Error).message);
    return undefined;
  }
}

export async function createSession(userId: string, { persist = true, sid }: { persist?: boolean; sid?: string } = {}) {
  const v = (await db.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } }))?.tokenVersion ?? 0;
  const id = await openSessionRow(userId, persist ? MAX_AGE : SHORT_AGE, sid);
  // "Don't remember this device" (1053): a browser-session cookie (gone when the browser closes) whose token
  // also stops working after a day, for browsers that restore session cookies on restart.
  const claims: Record<string, unknown> = { sub: userId, v, ...(id ? { sid: id } : {}), ...(persist ? {} : { rm: 0 }) };
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${persist ? MAX_AGE : SHORT_AGE}s`)
    .sign(secret);
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(persist ? { maxAge: MAX_AGE } : {}),
  });
}

export function destroySession() {
  cookies().delete(SESSION_COOKIE);
  cookies().delete("outlly_in"); // readable signed-in hint kept by middleware
}

/** Cookie contents, signature-checked only. Tokens issued before `v` existed read as v=0; before 1080, sid=null. */
async function readSessionClaims(): Promise<{ id: string; v: number; iat: number; rm: boolean; sid: string | null } | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return { id: payload.sub, v: typeof payload.v === "number" ? payload.v : 0, iat: payload.iat ?? 0, rm: payload.rm !== 0, sid: typeof payload.sid === "string" ? payload.sid : null };
  } catch {
    return null;
  }
}

/** Signed-in user id, revocation included (one cheap query). Null once the token version is stale. */
export async function readSessionUserId(): Promise<string | null> {
  const claims = await readSessionClaims();
  if (!claims) return null;
  const u = await db.user.findUnique({ where: { id: claims.id }, select: { tokenVersion: true, ...sessionCheck(claims.sid) } });
  return u && u.tokenVersion === claims.v && sessionAlive(u, claims.sid) ? claims.id : null;
}

/** Same query, one more relation: the cookie's own Active sessions row, when it has one (1080). */
const sessionCheck = (sid: string | null) => (sid ? { sessions: { where: { id: sid }, select: { id: true } } } : {});
/** Signed out from another device: its row is gone. Cookies without `sid` (pre-1080) pass. */
const sessionAlive = (u: object, sid: string | null) => !sid || ((u as { sessions?: unknown[] }).sessions?.length ?? 0) > 0;

/** The Active sessions row id this browser's cookie carries, or null (signed out, or a pre-1080 cookie). */
export async function currentSessionId(): Promise<string | null> {
  return (await readSessionClaims())?.sid ?? null;
}

/** Sign-out here (1080): the row goes too, so it leaves Active sessions on every other device at once. */
export async function endSession() {
  const sid = await currentSessionId();
  if (sid) await db.userSession.deleteMany({ where: { id: sid } }).catch(() => {});
  destroySession();
}

/** Re-issue this browser's cookie on the current token version, keeping its row and its remember choice. */
export async function reissueSession(userId: string) {
  const claims = await readSessionClaims();
  await createSession(userId, { persist: claims?.rm !== false, sid: claims?.sid ?? undefined });
}

const RENEW_AFTER = 60 * 60 * 24 * 3;
export const sessionNeedsRenewal = (iat: number, now = Math.floor(Date.now() / 1000)) => now - iat > RENEW_AFTER;

/**
 * The app keeps people signed in while they keep using it: past 3 days old, its session is re-issued for
 * another 14. Only the app asks for this; on the web a session still ends after 14 days.
 */
export async function renewSession() {
  const claims = await readSessionClaims();
  if (!claims || !sessionNeedsRenewal(claims.iat)) return false;
  if ((await readSessionUserId()) !== claims.id) return false;
  if (!claims.rm) return false; // a "don't remember" sign-in is never stretched
  await createSession(claims.id, { sid: claims.sid ?? undefined });
  return true;
}

/** Invalidate every session this person has anywhere. Call after logout-everywhere or a password change. */
export async function revokeAllSessions(userId: string) {
  await db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  await db.userSession.deleteMany({ where: { userId } }).catch(() => {}); // 1080: and the list empties
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
  const found = await db.user.findUnique({ where: { id }, select: { ...USER_SELECT, tokenVersion: true, ...sessionCheck(claims.sid) } });
  // Revoked elsewhere ("sign out everywhere", password change): the cookie verifies but is one version behind.
  // Or signed out from Active sessions on another device (1080): its row is gone.
  if (!found || found.tokenVersion !== claims.v || !sessionAlive(found, claims.sid)) return null;
  const { tokenVersion: _v, sessions: _s, ...me } = found as typeof found & { sessions?: unknown };
  const ws = cookies().get(WS_COOKIE)?.value;
  if (ws && ws !== id) {
    const seat = await db.teamMember.findFirst({ where: { ownerId: ws, userId: id, status: "active" }, select: { role: true, accountIds: true, owner: { select: USER_SELECT } } });
    if (seat && (TEAM_ROLES as readonly string[]).includes(seat.role))
      return { ...seat.owner, joinedAt: me.createdAt, actor: { id: me.id, name: me.name, email: me.email } as Actor | null, role: seat.role as WorkspaceRole, scope: parseScope(seat.accountIds) };
  }
  // scope (1037): the accounts this person may work on in this workspace; null = all of them (always for the owner)
  return { ...me, joinedAt: me.createdAt, actor: null as Actor | null, role: "owner" as WorkspaceRole, scope: null as Scope };
});

export type Actor = { id: string; name: string; email: string };
/** The person actually signed in, whichever workspace they're in. */
export const realUserId = (u: { id: string; actor: Actor | null }) => u.actor?.id ?? u.id;

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
