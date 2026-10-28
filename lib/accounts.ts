import "server-only";
import { db } from "./db";
import { encrypt } from "./crypto";
import type { Platform } from "./domain";
import type { ConnectedProfile } from "./social/types";
import { dmsOn } from "./social/keys";

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
  const acct = await db.socialAccount.upsert({
    where: { userId_platform_platformUserId: { userId, platform, platformUserId: prof.platformUserId } },
    create: { userId, platform, platformUserId: prof.platformUserId, ...data },
    update: data,
  });
  await subscribeDms(platform, acct);
  return acct;
}

/**
 * Direct messages (1031): ask Meta to send this account's messages to our webhook. Best effort: before
 * Meta approves the messaging permissions this is refused, and connecting must still succeed.
 */
async function subscribeDms(platform: Platform, acct: { platformUserId: string; id: string; username: string; accessToken: string }) {
  if ((platform !== "instagram" && platform !== "facebook") || acct.platformUserId.startsWith("mock-")) return;
  if (!dmsOn(platform)) return; // switched off by the admin (1031f): we never asked for the permission
  try {
    const { subscribeMessaging } = await import("./messages/meta");
    const { decrypt } = await import("./crypto");
    await subscribeMessaging(platform, { id: acct.id, platformUserId: acct.platformUserId, username: acct.username, accessToken: decrypt(acct.accessToken), refreshToken: null });
  } catch (e) {
    console.warn(`[dm] ${platform} webhook subscribe skipped:`, (e as Error).message?.slice(0, 300));
  }
}
