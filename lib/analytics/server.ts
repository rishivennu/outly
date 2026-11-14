import "server-only";
import { PostHog } from "posthog-node";
import { posthogHost, posthogKey } from "./config";
import { cleanProps, type AnalyticsEvent, type EventProps } from "./track";

/*
 * 1149: server-side capture for events the browser never sees (a payment confirmed by a webhook). Analytics is
 * consent-based, so callers pass the person's choice: from a request, consentFromCookie(req.cookies.get(...)).
 * Without consent, without a key, or in tests this does nothing. Never throws.
 */
export const CONSENT_COOKIE = "outly-consent";
/** CookieConsent writes "a" (analytics), "m" (marketing), "n" (necessary), e.g. "amn" or "n". */
export const consentFromCookie = (value: string | undefined | null) => !!value && /^a?m?n$/.test(value) && value.startsWith("a");

let client: PostHog | null | undefined;
function get() {
  if (client === undefined) {
    const key = posthogKey();
    client = key && process.env.NODE_ENV !== "test" ? new PostHog(key, { host: posthogHost(), flushAt: 1, flushInterval: 0 }) : null;
  }
  return client;
}

export async function captureServer(opts: { distinctId: string; event: AnalyticsEvent; consent: boolean; props?: EventProps }) {
  if (!opts.consent || !opts.distinctId) return;
  const c = get();
  if (!c) return;
  try {
    c.capture({ distinctId: opts.distinctId, event: opts.event, properties: cleanProps(opts.props) });
    await Promise.race([c.flush(), new Promise((r) => setTimeout(r, 2_000))]);
  } catch {
    /* analytics never breaks a payment */
  }
}
