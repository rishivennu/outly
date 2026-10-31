import "server-only";
import { headers } from "next/headers";
import { db } from "./db";
import { currentSessionId, reissueSession } from "./auth";
import { deviceLabel } from "./geo";
import { forgetAllTrusted, rememberDevice, trustedFor } from "./trusted-device";

/**
 * Settings > Active sessions (1080). Every sign-in since 1080 has a row; its id rides in the session cookie
 * as `sid`, and lib/auth refuses a cookie whose row is gone. So signing out one device is a row delete.
 */
export type SessionRow = { id: string; label: string; place: string | null; app: boolean; createdAt: string; lastSeenAt: string; current: boolean; legacy?: boolean };

/** Cookies from before 1080 carry no `sid`; for 14 days (their longest life) the card explains why they aren't listed. */
export const SESSIONS_SINCE = Date.parse("2026-11-01T00:00:00Z");
export const legacyWindowOpen = (now = Date.now()) => now < SESSIONS_SINCE + 14 * 864e5;

const TOUCH_EVERY = 5 * 60_000;

export async function listSessions(userId: string): Promise<SessionRow[]> {
  const sid = await currentSessionId();
  const rows = await db.userSession.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, label: true, place: true, app: true, createdAt: true, lastSeenAt: true },
  });
  const out: SessionRow[] = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), current: r.id === sid }));
  // This device always comes first, even on a pre-1080 cookie that has no row of its own.
  const i = out.findIndex((r) => r.current);
  if (i > 0) out.unshift(...out.splice(i, 1));
  if (i < 0) {
    const now = new Date().toISOString();
    out.unshift({ id: "this", label: deviceLabel(headers().get("user-agent")), place: null, app: false, createdAt: now, lastSeenAt: now, current: true, legacy: true });
  }
  return out;
}

/** Sign one other device out. This device signs out with the normal Sign out instead. */
export async function revokeSession(userId: string, id: string): Promise<"ok" | "gone" | "current"> {
  if (id === (await currentSessionId())) return "current";
  const r = await db.userSession.deleteMany({ where: { id, userId } });
  return r.count ? "ok" : "gone";
}

/**
 * Every device but this one. The token version bump also ends pre-1080 cookies, which have no row to delete,
 * and every remembered device; this browser gets a fresh cookie (same row) and, if it was remembered, stays so.
 */
export async function revokeOtherSessions(userId: string): Promise<number> {
  const sid = await currentSessionId();
  const wasTrusted = await trustedFor(userId).catch(() => false);
  const gone = await db.userSession.deleteMany({ where: { userId, ...(sid ? { id: { not: sid } } : {}) } });
  await db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  await reissueSession(userId);
  await forgetAllTrusted(userId);
  if (wasTrusted) await rememberDevice(userId).catch(() => {});
  return gone.count;
}

/** Last active, at most one write per 5 minutes per device. Never throws. */
export async function touchSession(): Promise<void> {
  try {
    const sid = await currentSessionId();
    if (!sid) return;
    await db.userSession.updateMany({ where: { id: sid, lastSeenAt: { lt: new Date(Date.now() - TOUCH_EVERY) } }, data: { lastSeenAt: new Date() } });
  } catch {
    /* presence only */
  }
}
