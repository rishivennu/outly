import "server-only";
import type { Platform } from "../domain";
import { creds } from "./keys";

/**
 * Disconnect (1095): besides wiping our copy of the keys, tell the platform to forget the grant where it
 * offers a documented way to. That also makes the next sign-in ask again instead of quietly reusing it.
 * Best effort only: a slow or failing platform never blocks a disconnect, and nothing here throws.
 *   Google: oauth2.googleapis.com/revoke (the refresh token revokes the whole grant)
 *   X:      POST /2/oauth2/revoke
 *   TikTok: POST /v2/oauth/revoke/
 * Instagram, Facebook Pages, Threads and LinkedIn have no revoke call for these tokens; their keys are wiped
 * on our side and the creator can remove Outlly in the platform's own app settings.
 */
import { REVOCABLE_PLATFORMS as REVOCABLE } from "./revocable";
export { REVOCABLE };

const TIMEOUT_MS = 4000;

export async function revokeAtPlatform(platform: Platform, tokens: { accessToken: string; refreshToken?: string | null }): Promise<boolean> {
  const token = tokens.refreshToken || tokens.accessToken;
  if (!token || !REVOCABLE.includes(platform)) return false;
  const post = (url: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(body), signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  try {
    if (platform === "youtube") return (await post("https://oauth2.googleapis.com/revoke", { token })).ok;
    if (platform === "x") {
      const { clientId, clientSecret } = creds("x");
      const basic = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const r = await post("https://api.x.com/2/oauth2/revoke", { token, token_type_hint: tokens.refreshToken ? "refresh_token" : "access_token", client_id: clientId }, { authorization: basic });
      return r.ok;
    }
    const { clientId, clientSecret } = creds("tiktok");
    const r = await post("https://open.tiktokapis.com/v2/oauth/revoke/", { client_key: clientId, client_secret: clientSecret, token: tokens.accessToken });
    return r.ok;
  } catch (e) {
    console.warn(`[disconnect] ${platform} revoke skipped:`, (e as Error).message?.slice(0, 200));
    return false;
  }
}
