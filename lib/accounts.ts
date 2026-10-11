import "server-only";
import { db } from "./db";
import { encrypt } from "./crypto";
import type { Platform } from "./domain";
import type { ConnectedProfile } from "./social/types";

/** Store a freshly connected account. One account per platform per creator; reconnecting replaces it. */
export async function saveConnectedAccount(userId: string, platform: Platform, prof: ConnectedProfile) {
  const data = {
    username: prof.username,
    displayName: prof.displayName ?? null,
    avatar: prof.avatar ?? null,
    accessToken: encrypt(prof.accessToken),
    refreshToken: prof.refreshToken ? encrypt(prof.refreshToken) : null,
    tokenExpiresAt: prof.expiresAt ?? null,
    metadata: prof.metadata ? JSON.stringify(prof.metadata) : null,
    status: "connected",
  };
  await db.socialAccount.deleteMany({ where: { userId, platform, NOT: { platformUserId: prof.platformUserId } } });
  return db.socialAccount.upsert({
    where: { userId_platform_platformUserId: { userId, platform, platformUserId: prof.platformUserId } },
    create: { userId, platform, platformUserId: prof.platformUserId, ...data },
    update: data,
  });
}
