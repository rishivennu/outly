import "server-only";
import { env } from "../env";
import { PLATFORMS, isCorePlatform, type Platform } from "../domain";
import type { SocialPublisher } from "./types";
import { InstagramPublisher } from "./instagram";
import { YouTubePublisher } from "./youtube";
import { XPublisher } from "./x";
import { TikTokPublisher } from "./tiktok";
import { ThreadsPublisher } from "./threads";
import { FacebookPublisher } from "./facebook";
import { LinkedInPublisher } from "./linkedin";
import { MockPublisher } from "./mock";
import { creds, loadKeys } from "./keys";

export { loadKeys };

/** The one place that knows which class handles which platform. */
const real: Record<Platform, () => SocialPublisher> = {
  instagram: () => new InstagramPublisher(),
  youtube: () => new YouTubePublisher(),
  x: () => new XPublisher(),
  tiktok: () => new TikTokPublisher(),
  threads: () => new ThreadsPublisher(),
  facebook: () => new FacebookPublisher(),
  linkedin: () => new LinkedInPublisher(),
};

const credentialsPresent = (p: Platform) => {
  const c = creds(p);
  return !!c.clientId && !!c.clientSecret;
};

/** Instagram tokens publish and refresh without the app secret; YouTube and X refresh needs it. */
const tokenIsEnough: Partial<Record<Platform, true>> = { instagram: true };

export function isMock(platform: Platform) {
  return env.MOCK_SOCIAL_PUBLISHING || !credentialsPresent(platform);
}

export function hasCredentials(platform: Platform) {
  return credentialsPresent(platform);
}

/** Instagram can be connected by pasting a long-lived token from the Meta dashboard, no app secret needed. */
export function canConnectWithToken(platform: Platform) {
  return !!tokenIsEnough[platform];
}

/** Practice accounts only exist when the server is explicitly in rehearsal mode. */
export function practiceAllowed() {
  return env.MOCK_SOCIAL_PUBLISHING;
}

/** Practice accounts are created by MockPublisher.completeConnect and carry a mock- platform id. */
export function isPracticeAccount(a: { platformUserId: string }) {
  return a.platformUserId.startsWith("mock-");
}

/** Used for connecting: practice when mocking is on or the platform has no credentials yet. */
export function getPublisher(platform: Platform): SocialPublisher {
  return isMock(platform) ? new MockPublisher(platform) : real[platform]();
}

/**
 * Used for publishing: the account decides. A practice account always rehearses (never touches the real API);
 * a real account always uses the real API, even if MOCK_SOCIAL_PUBLISHING is flipped on later.
 */
export function publisherForAccount(platform: Platform, account: { platformUserId: string }): SocialPublisher {
  if (isPracticeAccount(account)) return new MockPublisher(platform);
  if (!hasCredentials(platform) && !tokenIsEnough[platform]) throw new Error(`Real ${platform} account but ${platform.toUpperCase()}_CLIENT_ID/SECRET are missing. Add them in Admin > Social platforms.`);
  return real[platform]();
}

/**
 * Platforms the studio offers right now: the original three always, plus every other platform whose
 * app keys an admin has saved. Call after `await loadKeys()`.
 */
export function livePlatforms(): Platform[] {
  return PLATFORMS.filter((p) => isCorePlatform(p) || credentialsPresent(p));
}

/** Convenience for pages and routes: refresh the key snapshot, then answer. */
export async function liveNow() {
  await loadKeys();
  return livePlatforms();
}
