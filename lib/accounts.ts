import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { encrypt } from "./crypto";
import type { Platform } from "./domain";
import type { ConnectedProfile } from "./social/types";
import { dmsOn } from "./social/keys";
import { checkAccounts, entitlements } from "./billing/entitlements";

/**
 * Store a freshly connected account. On most plans that's one account per platform: connecting another
 * replaces it (the old one is set aside as disconnected, so its posts keep their history). A multi-account plan (Pro Multi-Account Manager, 1037) keeps every account side by side, up to
 * its total; reconnecting an account that's already there never counts as a new one.
 */
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
  const e = await entitlements(userId);
  // Count and write in one serializable transaction, so two connects finishing at once can't both take the last place.
  const acct = await db.$transaction(
    async (tx) => {
      if (e.accountLimit > 0) {
        const others = await tx.socialAccount.count({ where: { userId, status: { not: "disconnected" }, NOT: { platform, platformUserId: prof.platformUserId } } });
        checkAccounts(e, others);
      } else {
        // One account per platform: the others are set aside, never deleted. A Pro owner whose plan lapsed keeps
        // their accounts and every post linked to them, and reconnecting after renewing brings each one back.
        await tx.socialAccount.updateMany({
          where: { userId, platform, status: { not: "disconnected" }, NOT: { platformUserId: prof.platformUserId } },
          data: { status: "disconnected", accessToken: encrypt(""), refreshToken: null, tokenExpiresAt: null },
        });
      }
      return tx.socialAccount.upsert({
        where: { userId_platform_platformUserId: { userId, platform, platformUserId: prof.platformUserId } },
        create: { userId, platform, platformUserId: prof.platformUserId, ...data },
        update: data,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
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
