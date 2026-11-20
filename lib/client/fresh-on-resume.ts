/**
 * R1283: an installed app page (Home Screen app, installed PWA, the Android app) stays alive for days and never
 * navigates again, so it keeps the CSS and JS of the build it was opened with. When it comes back after a while it
 * asks /api/build which build the server runs now and, if that differs, offers a reload. It never reloads by itself:
 * a draft in Create must not vanish. Pure parts, kept here so they are unit tested.
 */
export const RESUME_AFTER_MS = 10 * 60_000;
export const BUILD_URL = "/api/build";
export const UPDATE_TEXT = "Outlly has an update.";
export const UPDATE_ACTION = "Reload";
export const UPDATE_TOAST_MS = 20_000;
/** sessionStorage: the build already announced in this session, so one toast per build per session. */
export const SEEN_KEY = "outlly:update-seen";

type InstallEnv = {
  matchMedia?: (q: string) => { matches: boolean };
  navigator?: object;
  document?: { documentElement: { hasAttribute: (name: string) => boolean } };
};

/** A launched app, not a browser tab: standalone display, an iPhone Home Screen app, or html[data-app] (Android app). */
export function isInstalled(w: InstallEnv): boolean {
  try {
    if (w.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {}
  return (w.navigator as { standalone?: boolean } | undefined)?.standalone === true || w.document?.documentElement.hasAttribute("data-app") === true;
}

/** Only a page that has been away at least ten minutes asks; a quick app switch costs nothing. */
export function shouldCheck(hiddenAt: number | null, now: number): boolean {
  return hiddenAt !== null && now - hiddenAt >= RESUME_AFTER_MS;
}

/** A real, different build. "dev" (no build id at build time) never counts, on either side. */
export function isNewBuild(served: string, live: unknown): live is string {
  return typeof live === "string" && live !== "" && live !== "dev" && served !== "dev" && live !== served;
}
