import "server-only";
import type { SocialAccount } from "@prisma/client";
import { db } from "../db";
import { decrypt, encrypt } from "../crypto";
import { isPlatform } from "../domain";
import { publisherForAccount } from "../social/registry";
import { asPublisherError, PublisherError, type AccountContext } from "../social/types";

/** Refresh when the access token has less than this left. */
export const REFRESH_AHEAD_MS = 5 * 60_000;

const g = globalThis as unknown as { __refreshing?: Map<string, Promise<SocialAccount>> };
const inflight: Map<string, Promise<SocialAccount>> = (g.__refreshing ??= new Map());

const expiresWithin = (a: Pick<SocialAccount, "tokenExpiresAt">, ms: number) => !!a.tokenExpiresAt && a.tokenExpiresAt.getTime() - Date.now() < ms;

/**
 * The one place an account's token is refreshed (1027). Before, the publish pipeline, the first-comment job,
 * the sweeper and every inbox/analytics read each refreshed on their own, from whatever copy of the row they
 * had loaded. Platforms that rotate refresh tokens (X, TikTok) accept each refresh token once, so the second
 * caller was refused and its 400 read as "media rejected": the account stayed "connected", the post failed
 * with a misleading reason, and a retry could post twice. Now:
 *  - one refresh per account at a time in this process (the others wait for it and share the result);
 *  - the row is re-read first, so a refresh another instance already did is used, not repeated;
 *  - a refusal that turns out to be a lost race (the stored token changed meanwhile) uses the winner's token;
 *  - any other permanent refusal is AUTH_EXPIRED and the account is marked needs_reconnect.
 * Returns the current row; throws PublisherError.
 */
export async function freshAccount(acct: SocialAccount, aheadMs = REFRESH_AHEAD_MS): Promise<SocialAccount> {
  if (!isPlatform(acct.platform) || !expiresWithin(acct, aheadMs)) return acct;
  const running = inflight.get(acct.id);
  if (running) return running;
  const job = refreshNow(acct, aheadMs).finally(() => inflight.delete(acct.id));
  inflight.set(acct.id, job);
  return job;
}

async function refreshNow(stale: SocialAccount, aheadMs: number): Promise<SocialAccount> {
  const cur = (await db.socialAccount.findUnique({ where: { id: stale.id } })) ?? stale;
  if (!isPlatform(cur.platform) || !expiresWithin(cur, aheadMs)) return cur;
  if (cur.status !== "connected") throw new PublisherError("AUTH_EXPIRED", "Authorization expired", `The ${cur.platform} account needs reconnecting.`, false);
  // Outside the try: missing app keys is a setup problem, not a reason to make the creator reconnect.
  const publisher = publisherForAccount(cur.platform, cur);
  try {
    const fresh = await publisher.refreshToken({
      id: cur.id,
      platformUserId: cur.platformUserId,
      username: cur.username,
      accessToken: decrypt(cur.accessToken),
      refreshToken: cur.refreshToken ? decrypt(cur.refreshToken) : null,
    });
    return await db.socialAccount.update({
      where: { id: cur.id },
      data: {
        accessToken: encrypt(fresh.accessToken),
        ...(fresh.refreshToken ? { refreshToken: encrypt(fresh.refreshToken) } : {}),
        tokenExpiresAt: fresh.expiresAt ?? null,
      },
    });
  } catch (e) {
    const pe = asPublisherError(e);
    // Another instance refreshed between our read and our call: its token is the good one.
    const now = await db.socialAccount.findUnique({ where: { id: cur.id } }).catch(() => null);
    if (now && now.status === "connected" && now.accessToken !== cur.accessToken) return now;
    if (pe.retryable) throw pe; // network / rate limit / platform down: try again later, the account is fine
    await db.socialAccount.updateMany({ where: { id: cur.id, accessToken: cur.accessToken }, data: { status: "needs_reconnect" } }).catch(() => {});
    throw new PublisherError("AUTH_EXPIRED", "Authorization expired", pe.technical ?? pe.message, false);
  }
}

export function accountContext(acct: SocialAccount): AccountContext {
  return {
    id: acct.id,
    platformUserId: acct.platformUserId,
    username: acct.username,
    accessToken: decrypt(acct.accessToken),
    refreshToken: acct.refreshToken ? decrypt(acct.refreshToken) : null,
    tokenExpiresAt: acct.tokenExpiresAt,
  };
}

/**
 * Decrypt a stored account and make sure its access token is usable right now.
 * YouTube tokens live one hour, so anything that reads live data must go through here.
 */
export async function liveAccount(acct: SocialAccount): Promise<AccountContext> {
  return accountContext(await freshAccount(acct));
}
