import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import { HttpError } from "./http";
import type { Platform } from "./domain";
import type { ConnectedProfile } from "./social/types";
import { dmsOn } from "./social/keys";
import { checkAccounts, checkBrands, checkPlatforms, checkX, entitlements } from "./billing/entitlements";
import { isMultiAccount } from "./billing/plan-rules";
import { noticeAccountConnected } from "./notify-events";

/**
 * Store a connected account, keyed by the platform's stable id: a row is only ever updated by the same
 * account, so two accounts are never merged. On most plans that's one account per platform, and since 1095 a
 * different account only replaces the current one when the creator said so (`replace`, from the Accounts
 * page's question); otherwise this refuses with REPLACE_NEEDED. The replaced one is set aside as disconnected,
 * so its posts keep their history. A multi-account plan (Pro Multi-Account Manager, 1037) keeps every account
 * side by side, up to its total; reconnecting an account that's already there never counts as a new one.
 * Callers decide whether to ask first (lib/connect-decision.ts); this is the last line, not the question.
 */
export async function saveConnectedAccount(userId: string, platform: Platform, prof: ConnectedProfile, opts: { replace?: boolean } = {}) {
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
      // 1096: an account already on file (e.g. its token expired) can always be reconnected, even when a plan
      // change left it over the new platform or brand count. Only a NEW account is checked against the caps.
      const known = await tx.socialAccount.findFirst({ where: { userId, platform, platformUserId: prof.platformUserId, status: { not: "disconnected" } }, select: { id: true } });
      // 1096: Free connects any N platforms; a platform already in use can always be reconnected or swapped.
      // 1112: plans without X (Free) can't add an X account; one already on file stays.
      if (platform === "x" && !known) checkX(e);
      if (e.platformLimit > 0 && !known) {
        const live = await tx.socialAccount.findMany({ where: { userId, status: { not: "disconnected" } }, select: { platform: true } });
        checkPlatforms(e, live.map((a) => a.platform), platform);
      }
      if (isMultiAccount(e)) {
        if (e.accountLimit > 0) {
          const others = await tx.socialAccount.count({ where: { userId, status: { not: "disconnected" }, NOT: { platform, platformUserId: prof.platformUserId } } });
          checkAccounts(e, others);
        }
        // 1096 brands: N brands = up to N accounts on each platform.
        if (e.brandLimit > 0 && !known) {
          const onPlatform = await tx.socialAccount.count({ where: { userId, platform, status: { not: "disconnected" }, NOT: { platformUserId: prof.platformUserId } } });
          checkBrands(e, onPlatform, platform);
        }
      } else {
        const others = await tx.socialAccount.findMany({ where: { userId, platform, status: { not: "disconnected" }, NOT: { platformUserId: prof.platformUserId } }, select: { username: true } });
        if (others.length && !opts.replace) throw new HttpError(409, `${others[0].username} is connected on this platform. Replace it first.`, "REPLACE_NEEDED");
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
  await noticeAccountConnected(acct); // 1118: never throws
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

/**
 * Disconnect (1095). A soft disconnect: the row stays, marked disconnected with its keys wiped, so published
 * posts, their analytics and Inbox history keep pointing at the account they came from (a hard delete used to
 * cut every post loose and cascade away the DMs). The stable id stays too, which is how a later sign-in knows
 * the account was here before and asks instead of silently reconnecting it. Where the platform has a revoke
 * call the grant is revoked as well, unless another studio still uses the same account.
 */
export async function disconnectAccounts(userId: string, platform: Platform, id?: string | null) {
  const rows = await db.socialAccount.findMany({
    where: { userId, platform, status: { not: "disconnected" }, ...(id ? { id } : {}) },
    select: { id: true, platformUserId: true, accessToken: true, refreshToken: true },
  });
  if (!rows.length) return 0;
  await db.socialAccount.updateMany({
    where: { userId, id: { in: rows.map((r) => r.id) } },
    data: { status: "disconnected", accessToken: encrypt(""), refreshToken: null, tokenExpiresAt: null },
  });
  const { revokeAtPlatform } = await import("./social/revoke");
  await Promise.all(
    rows.map(async (r) => {
      if (r.platformUserId.startsWith("mock-")) return;
      const shared = await db.socialAccount.count({ where: { platform, platformUserId: r.platformUserId, status: { not: "disconnected" } } });
      if (shared) return; // another studio still posts with this account; revoking the grant would cut it off too
      let tokens: { accessToken: string; refreshToken: string | null };
      try {
        tokens = { accessToken: decrypt(r.accessToken), refreshToken: r.refreshToken ? decrypt(r.refreshToken) : null };
      } catch {
        return;
      }
      await revokeAtPlatform(platform, tokens);
    }),
  );
  return rows.length;
}
