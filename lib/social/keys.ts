import "server-only";
import { env } from "../env";
import { getConfig, type KeyedPlatform, type PlatformKeys } from "../settings";

/**
 * Platform app keys. The admin console (Admin > Social platforms) is the source of truth; env vars are a
 * fallback so existing deploys keep working. Publishers read keys synchronously, so we keep a snapshot
 * that every API request, page and job refreshes through `loadKeys()` (15 s config cache underneath).
 */
const g = globalThis as unknown as { __pkeys?: Partial<PlatformKeys> };

const ENV = (): Partial<Record<KeyedPlatform, { clientId: string; clientSecret: string }>> => ({
  instagram: { clientId: env.INSTAGRAM_CLIENT_ID, clientSecret: env.INSTAGRAM_CLIENT_SECRET },
  youtube: { clientId: env.YOUTUBE_CLIENT_ID, clientSecret: env.YOUTUBE_CLIENT_SECRET },
  x: { clientId: env.X_CLIENT_ID, clientSecret: env.X_CLIENT_SECRET },
  facebook: { clientId: env.FACEBOOK_CLIENT_ID, clientSecret: env.FACEBOOK_CLIENT_SECRET },
  threads: { clientId: env.THREADS_CLIENT_ID, clientSecret: env.THREADS_CLIENT_SECRET },
  linkedin: { clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET },
  tiktok: { clientId: env.TIKTOK_CLIENT_ID, clientSecret: env.TIKTOK_CLIENT_SECRET },
});

export async function loadKeys() {
  try {
    g.__pkeys = await getConfig("platforms");
  } catch {
    /* DB unreachable: keep the last snapshot */
  }
  return g.__pkeys;
}

/** Admin-saved keys win field by field; env fills whatever the admin left empty. */
export function creds(p: KeyedPlatform): { clientId: string; clientSecret: string } {
  const a = g.__pkeys?.[p];
  const e = ENV()[p];
  return { clientId: a?.clientId || e?.clientId || "", clientSecret: a?.clientSecret || e?.clientSecret || "" };
}

/**
 * Direct messages (1031f). On unless the admin switched them off in Admin > Social platforms, which is how
 * an app goes live with publishing and comments while Meta is still reviewing the messaging permissions:
 * asking for a permission the app isn't approved for blocks the whole login for the public.
 */
export function dmsOn(p: "instagram" | "facebook"): boolean {
  return g.__pkeys?.[p]?.dms !== false;
}

/** Test hook: replace the snapshot without a database. */
export function __setKeys(k: Partial<PlatformKeys> | undefined) {
  g.__pkeys = k;
}

/**
 * Instagram Login has its own app ID (Instagram > API setup with Instagram login). Pasting the Meta App ID
 * instead makes instagram.com answer "Invalid platform app". When both match, that's what happened.
 */
export function instagramIdLooksLikeMetaAppId(): boolean {
  const ig = creds("instagram").clientId.trim();
  return !!ig && ig === creds("facebook").clientId.trim();
}
