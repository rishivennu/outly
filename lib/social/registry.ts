import "server-only";
import { env } from "../env";
import type { Platform } from "../domain";
import type { SocialPublisher } from "./types";
import { InstagramPublisher } from "./instagram";
import { YouTubePublisher } from "./youtube";
import { XPublisher } from "./x";
import { MockPublisher } from "./mock";

/**
 * The one place that knows which class handles which platform.
 * Adding TikTok later = write TikTokPublisher implements SocialPublisher, add it here and to PLATFORMS.
 */
const real: Record<Platform, () => SocialPublisher> = {
  instagram: () => new InstagramPublisher(),
  youtube: () => new YouTubePublisher(),
  x: () => new XPublisher(),
};

const credentialsPresent: Record<Platform, () => boolean> = {
  instagram: () => !!env.INSTAGRAM_CLIENT_ID && !!env.INSTAGRAM_CLIENT_SECRET,
  youtube: () => !!env.YOUTUBE_CLIENT_ID && !!env.YOUTUBE_CLIENT_SECRET,
  x: () => !!env.X_CLIENT_ID && !!env.X_CLIENT_SECRET,
};

/** Instagram tokens publish and refresh without the app secret; YouTube and X refresh needs it. */
const tokenIsEnough: Partial<Record<Platform, true>> = { instagram: true };

export function isMock(platform: Platform) {
  return env.MOCK_SOCIAL_PUBLISHING || !credentialsPresent[platform]();
}

export function hasCredentials(platform: Platform) {
  return credentialsPresent[platform]();
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
  if (!hasCredentials(platform) && !tokenIsEnough[platform]) throw new Error(`Real ${platform} account but ${platform.toUpperCase()}_CLIENT_ID/SECRET are missing.`);
  return real[platform]();
}
