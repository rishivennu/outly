/**
 * PostHog settings (1149). Client-safe: the project key is PostHog's public, write-only ingest key, so it may ship
 * in the bundle. Every value can be overridden by its env var; set NEXT_PUBLIC_POSTHOG_KEY to an empty string to
 * switch tracking off. The personal API key (POSTHOG_PERSONAL_API_KEY) has no default and is read on the server only.
 */
export const POSTHOG_DEFAULTS = {
  key: "phc_tnW4T9JziEaqwbj2VdoKfuQ5WZ6Us7ykvpDaHpT4kXPM",
  host: "https://us.i.posthog.com",
  appHost: "https://us.posthog.com",
  projectId: "735656",
} as const;

/** Same-origin reverse proxy (next.config.mjs rewrites), so ad blockers and the CSP see a first-party request. */
export const POSTHOG_PROXY = "/ingest";

const trim = (v: string | undefined) => v?.trim().replace(/\/+$/, "");

/** The literal process.env reads let Next inline NEXT_PUBLIC_* values into the client bundle. */
export const posthogKey = (): string => (process.env.NEXT_PUBLIC_POSTHOG_KEY ?? POSTHOG_DEFAULTS.key).trim();
export const posthogHost = (): string => trim(process.env.NEXT_PUBLIC_POSTHOG_HOST) || POSTHOG_DEFAULTS.host;

/** us.i.posthog.com -> us.posthog.com (the app, where people log in and the Query API lives). */
export function appHostFor(ingestHost: string): string {
  const m = /^https:\/\/(us|eu)\.i\.posthog\.com$/.exec(ingestHost);
  return m ? `https://${m[1]}.posthog.com` : POSTHOG_DEFAULTS.appHost;
}
