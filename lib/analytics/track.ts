import type { PostHog } from "posthog-js";

/** 1149: product analytics events. Client-safe and dependency-free until PostHogProvider attaches a client. */
export type AnalyticsEvent =
  | "signup_completed"
  | "trial_started"
  | "checkout_started"
  | "subscription_activated"
  | "post_scheduled"
  | "post_published"
  | "account_connected"
  | "library_upload";
export type EventProps = Record<string, string | number | boolean | null | undefined>;

/** Same storage key CookieConsent.tsx writes; read here so this module stays free of React. */
export const CONSENT_KEY = "outly-consent";
export const CONSENT_EVENT = "outly:consent";

export function analyticsConsent(raw: string | null | undefined): boolean {
  try {
    const c = JSON.parse(raw ?? "null");
    return c?.v === 1 && c.analytics === true;
  } catch {
    return false;
  }
}

export const isAdminPath = (path: string) => path === "/admin" || path.startsWith("/admin/");

export function analyticsAllowed(o: { key: string; consent: boolean; dnt: boolean; path: string }): boolean {
  return !!o.key && o.consent && !o.dnt && !isAdminPath(o.path);
}

// Contact details never leave the browser, whatever a call site passes.
const PRIVATE_PROP = /e-?mail|phone|password|token|^name$|address/i;
export function cleanProps(props?: EventProps): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(props ?? {})) if (v !== undefined && !PRIVATE_PROP.test(k)) out[k] = v;
  return out;
}

export type AnalyticsClient = Pick<PostHog, "capture" | "identify" | "reset" | "setPersonProperties" | "get_distinct_id" | "get_property" | "opt_in_capturing" | "opt_out_capturing">;

let client: AnalyticsClient | null = null;
// Events fired while posthog-js is still downloading. Null when tracking is off, so nothing is held.
let pending: [AnalyticsEvent, EventProps | undefined][] | null = null;
const PENDING_MAX = 20;
const waiting = new Set<(c: AnalyticsClient) => void>();

const onAdmin = () => typeof location !== "undefined" && isAdminPath(location.pathname);

export function track(name: AnalyticsEvent, props?: EventProps) {
  if (onAdmin()) return;
  if (client) client.capture(name, cleanProps(props));
  else if (pending && pending.length < PENDING_MAX) pending.push([name, props]);
}

export function analyticsLoading() {
  if (!client) pending ??= [];
}

export function attachAnalytics(c: AnalyticsClient) {
  client = c;
  const queued = pending ?? [];
  pending = null;
  for (const [n, p] of queued) track(n, p);
  for (const cb of waiting) cb(c);
}

export function detachAnalytics() {
  client = null;
  pending = null;
}

export const analyticsClient = () => client;

/** Runs `cb` once a client is attached (now, if it already is). Returns an unsubscribe. */
export function whenAnalyticsReady(cb: (c: AnalyticsClient) => void): () => void {
  if (client) {
    cb(client);
    return () => {};
  }
  const once = (c: AnalyticsClient) => {
    waiting.delete(once);
    cb(c);
  };
  waiting.add(once);
  return () => waiting.delete(once);
}
