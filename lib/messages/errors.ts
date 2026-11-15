import { PLATFORM_META } from "../domain";
import type { PublisherError } from "../social/types";
import type { DmPlatform } from "./meta";

/**
 * Phase 2 (1155): what a refused send or sync means for the creator, typed so the inbox can act on it.
 * Meta throttles messaging per account and per app (codes 4, 17, 32, 613, 80001-80014, see httpFailure);
 * when it says for how long (Retry-After or estimated_time_to_regain_access), the creator sees when to try again.
 */
export type DmFailureCode = "RATE_LIMITED" | "FORBIDDEN" | "NOT_CONNECTED" | "REJECTED" | "PLATFORM_DOWN" | "NETWORK" | "UNKNOWN";
export interface DmFailure {
  status: number;
  code: DmFailureCode;
  message: string;
  /** Seconds until Meta lets this account send again, when Meta said. */
  retryAfterSec: number | null;
  /** The same moment as an ISO time, so the browser can show it in the creator's clock. */
  retryAt: string | null;
}

export function waitWords(sec: number) {
  if (sec < 90) return "about a minute";
  const min = Math.round(sec / 60);
  if (min < 90) return `about ${min} minutes`;
  const h = Math.round(min / 60);
  return `about ${h} ${h === 1 ? "hour" : "hours"}`;
}

export function dmFailure(platform: DmPlatform, pe: Pick<PublisherError, "code" | "retryAfterMs">, action: "send" | "sync" = "send", now = Date.now()): DmFailure {
  const name = PLATFORM_META[platform].name;
  const none = { retryAfterSec: null, retryAt: null };
  switch (pe.code) {
    case "RATE_LIMITED": {
      const sec = typeof pe.retryAfterMs === "number" && pe.retryAfterMs > 0 ? Math.ceil(pe.retryAfterMs / 1000) : null;
      const when = sec ? `You can try again in ${waitWords(sec)}.` : "Meta didn't say for how long. Try again in a few minutes.";
      return { status: 429, code: "RATE_LIMITED", message: `${name} is limiting how fast this account can ${action === "send" ? "send messages" : "load messages"}. ${when}`, retryAfterSec: sec, retryAt: sec ? new Date(now + sec * 1000).toISOString() : null };
    }
    case "AUTH_EXPIRED":
      return { status: 409, code: "NOT_CONNECTED", message: `${name} needs you to reconnect.`, ...none };
    case "FORBIDDEN":
      return action === "send"
        ? { status: 403, code: "FORBIDDEN", message: `${name} didn't let Outlly send this. The app may still be waiting for Meta to approve messaging, or this person can't be messaged by apps.`, ...none }
        : { status: 403, code: "FORBIDDEN", message: `${name} didn't share messages yet. Reconnect ${name} so Outlly can ask for the messaging permission. While the Meta app is in Development mode, only people with a role on the app show up.`, ...none };
    case "MEDIA_REJECTED":
      return { status: 422, code: "REJECTED", message: `${name} didn't accept that message. Try shorter text without unusual characters.`, ...none };
    case "PLATFORM_DOWN":
      return { status: 502, code: "PLATFORM_DOWN", message: `${name} is having trouble right now. Try again in a moment.`, ...none };
    case "NETWORK":
      return { status: 502, code: "NETWORK", message: `We couldn't reach ${name} just now. Try again in a moment.`, ...none };
    default:
      return { status: 502, code: "UNKNOWN", message: `We couldn't reach ${name} just now. Try again in a moment.`, ...none };
  }
}
