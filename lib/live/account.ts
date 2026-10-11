import "server-only";
import type { SocialAccount } from "@prisma/client";
import { db } from "../db";
import { decrypt, encrypt } from "../crypto";
import { isPlatform } from "../domain";
import { publisherForAccount } from "../social/registry";
import type { AccountContext } from "../social/types";

/**
 * Decrypt a stored account and make sure its access token is usable right now.
 * YouTube tokens live one hour, so anything that reads live data must go through here.
 */
export async function liveAccount(acct: SocialAccount): Promise<AccountContext> {
  let accessToken = decrypt(acct.accessToken);
  const refreshToken = acct.refreshToken ? decrypt(acct.refreshToken) : null;
  let tokenExpiresAt = acct.tokenExpiresAt;
  if (isPlatform(acct.platform) && tokenExpiresAt && tokenExpiresAt.getTime() - Date.now() < 5 * 60_000) {
    const fresh = await publisherForAccount(acct.platform, acct).refreshToken({ id: acct.id, platformUserId: acct.platformUserId, username: acct.username, accessToken, refreshToken });
    accessToken = fresh.accessToken;
    tokenExpiresAt = fresh.expiresAt ?? null;
    await db.socialAccount.update({
      where: { id: acct.id },
      data: { accessToken: encrypt(fresh.accessToken), ...(fresh.refreshToken ? { refreshToken: encrypt(fresh.refreshToken) } : {}), tokenExpiresAt },
    });
  }
  return { id: acct.id, platformUserId: acct.platformUserId, username: acct.username, accessToken, refreshToken, tokenExpiresAt };
}
