import "server-only";
import type { NextRequest } from "next/server";
import { APP_SELLS_PLANS } from "./app-mode";
import { realUserId, type SessionUser } from "./auth";
import { db } from "./db";
import { nativeClient } from "./native-client";
import { pushConfigured } from "./push/fcm";

/** GET /api/me's `user` (R1294: shared with /api/app/bootstrap and the sign-in answers the app reads). */
export function meUser(user: SessionUser) {
  return { id: realUserId(user), name: user.actor?.name ?? user.name, email: user.actor?.email ?? user.email, avatar: user.actor ? null : user.avatar, timezone: user.timezone, joinedAt: user.joinedAt };
}

export function meBody(user: SessionUser, app: boolean) {
  return {
    user: meUser(user),
    workspace: user.actor ? { ownerId: user.id, ownerName: user.name, ownerAvatar: user.avatar, role: user.role } : null,
    role: user.role,
    features: { sellsPlans: app ? APP_SELLS_PLANS : true, push: pushConfigured() },
  };
}

/**
 * R1294: `{ user }` for the app's sign-in answers, the same shape as GET /api/me .user. The cookie set by this very
 * request isn't readable yet, so the person is read by id; a fresh sign-in is always in their own workspace. Browsers
 * (no x-outlly-client header) get nothing extra, so the web answers stay exactly as they were.
 */
export async function withAppUser(req: NextRequest, userId: string | null | undefined): Promise<{ user?: ReturnType<typeof meUser> }> {
  if (!userId || !nativeClient(req)) return {};
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, avatar: true, timezone: true, createdAt: true } });
  return u ? { user: { id: u.id, name: u.name, email: u.email, avatar: u.avatar, timezone: u.timezone, joinedAt: u.createdAt } } : {};
}
