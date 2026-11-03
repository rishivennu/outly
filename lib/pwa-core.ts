/**
 * Add to Home Screen (1099). Pure rules, shared by the studio banner (components/shell/InstallPrompt.tsx),
 * the admin card and the tests. No DOM access here: callers pass what they read from the browser.
 *
 * When it shows: phone widths, on a calm page (never Create or an editor), from the Nth visit, after the
 * person has been on the page a while with nothing else on screen. Never inside the Android app (TWA),
 * never once Outlly runs installed, never in in-app browsers (Instagram, Facebook...) that cannot install.
 * A dismissal waits `cooldownDays`, doubled each time, and after `maxDismissals` it stops for good.
 */

export interface InstallConfig {
  enabled: boolean;
  /** Visits on this browser before the first suggestion (a visit = a new tab session). */
  minVisits: number;
  /** Seconds on a calm page before it slides in. */
  delaySec: number;
  /** Days to wait after the first "Not now"; each further dismissal doubles it. */
  cooldownDays: number;
  /** After this many dismissals it never shows again on that browser. */
  maxDismissals: number;
}

export const INSTALL_DEFAULT: InstallConfig = { enabled: true, minVisits: 2, delaySec: 20, cooldownDays: 21, maxDismissals: 3 };

export const INSTALL_LIMITS = {
  minVisits: [1, 10],
  delaySec: [5, 120],
  cooldownDays: [1, 180],
  maxDismissals: [1, 10],
} as const;

const clampInt = (v: unknown, [lo, hi]: readonly [number, number], d: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d;
  return Math.min(hi, Math.max(lo, n));
};

export function normalizeInstall(c: Partial<InstallConfig> | null | undefined): InstallConfig {
  const d = INSTALL_DEFAULT;
  return {
    enabled: typeof c?.enabled === "boolean" ? c.enabled : d.enabled,
    minVisits: clampInt(c?.minVisits, INSTALL_LIMITS.minVisits, d.minVisits),
    delaySec: clampInt(c?.delaySec, INSTALL_LIMITS.delaySec, d.delaySec),
    cooldownDays: clampInt(c?.cooldownDays, INSTALL_LIMITS.cooldownDays, d.cooldownDays),
    maxDismissals: clampInt(c?.maxDismissals, INSTALL_LIMITS.maxDismissals, d.maxDismissals),
  };
}

/** What this browser keeps (localStorage, one key). */
export interface InstallState {
  visits: number;
  dismissals: number;
  /** ms epoch of the last dismissal, 0 = never. */
  dismissedAt: number;
  /** ms epoch the iOS steps were last shown: a pause of `cooldownDays`, not a strike (we cannot see an iOS install). */
  guidedAt: number;
  installed: boolean;
}

export const INSTALL_KEY = "outlly:install";
/** sessionStorage flag: this tab session was already counted as a visit. */
export const INSTALL_VISIT_KEY = "outlly:install-visit";
export const EMPTY_STATE: InstallState = { visits: 0, dismissals: 0, dismissedAt: 0, guidedAt: 0, installed: false };

export function parseState(raw: string | null | undefined): InstallState {
  if (!raw) return { ...EMPTY_STATE };
  try {
    const o = JSON.parse(raw) as Partial<InstallState>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return { visits: n(o.visits), dismissals: n(o.dismissals), dismissedAt: n(o.dismissedAt), guidedAt: n(o.guidedAt), installed: o.installed === true };
  } catch {
    return { ...EMPTY_STATE };
  }
}

const DAY = 86_400_000;

/** Days until it may show again after `dismissals` dismissals (0 = no wait). */
export function cooldownFor(dismissals: number, cfg: InstallConfig): number {
  if (dismissals <= 0) return 0;
  return cfg.cooldownDays * 2 ** (dismissals - 1);
}

export function shouldOffer(s: InstallState, cfg: InstallConfig, now: number): boolean {
  if (!cfg.enabled || s.installed) return false;
  if (s.dismissals >= cfg.maxDismissals) return false;
  if (s.visits < cfg.minVisits) return false;
  if (s.dismissals > 0 && now - s.dismissedAt < cooldownFor(s.dismissals, cfg) * DAY) return false;
  if (s.guidedAt > 0 && now - s.guidedAt < cfg.cooldownDays * DAY) return false;
  return true;
}

export const dismiss = (s: InstallState, now: number): InstallState => ({ ...s, dismissals: s.dismissals + 1, dismissedAt: now });
/** The iOS steps were read: wait one cooldown, but do not count it towards "stop for good". */
export const guided = (s: InstallState, now: number): InstallState => ({ ...s, guidedAt: now });

/** Pages where a nudge never interrupts: lists and dashboards, not Create, editors or checkout. */
const CALM = ["/home", "/calendar", "/content", "/analytics", "/inbox"];
export const isCalmPage = (path: string) => CALM.includes(path.replace(/\/+$/, "") || "/");

/** Browsers inside other apps: they cannot add to the Home Screen, so never ask. */
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Line\/|Twitter|TikTok|musical_ly|BytedanceWebview|Snapchat|Pinterest|GSA\/|; wv\)/i;

export function isIOS(ua: string, platform = "", maxTouchPoints = 0): boolean {
  // iPadOS 13+ reports itself as a Mac; a Mac with a touch screen is an iPad.
  return /iPhone|iPad|iPod/i.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export type InstallMode = "prompt" | "ios" | null;

/**
 * "prompt": the browser handed us its install prompt (Android Chrome, Edge, Samsung Internet...).
 * "ios": Safari, or another iOS browser (16.4+ lets them add from the Share sheet too): show the 3 steps.
 * null: nothing we can honestly offer (desktop Firefox, in-app browsers, Android without the prompt).
 */
export function installMode(o: { ua: string; platform?: string; maxTouchPoints?: number; hasPrompt: boolean }): InstallMode {
  if (IN_APP.test(o.ua)) return null;
  if (o.hasPrompt) return "prompt";
  if (isIOS(o.ua, o.platform, o.maxTouchPoints)) return "ios";
  return null;
}

/** Signals that Outlly is already running installed (or inside the Android app). */
export function runningInstalled(o: { standalone: boolean; iosStandalone?: boolean; appMode: boolean; referrer?: string; search?: string }): boolean {
  if (o.standalone || o.iosStandalone || o.appMode) return true;
  if ((o.referrer ?? "").startsWith("android-app://")) return true;
  return new URLSearchParams(o.search ?? "").get("source") === "pwa";
}

/**
 * Proof strong enough to remember forever. `?source=pwa` is left out: it is the manifest start_url, so a
 * shared or bookmarked copy would otherwise retire the card on a plain browser. It still hides it for that load.
 */
export const provenInstalled = (o: Parameters<typeof runningInstalled>[0]) => runningInstalled({ ...o, search: "" });

/** Studio routes (not marketing). Only here, on a phone-width screen, do we hold back Chrome's own install bar. */
export const STUDIO_RE = /^\/(home|calendar|content|analytics|inbox|create|accounts|approvals|billing|settings|support|mascot)(\/|$)/;

/**
 * Runs in <head> before React: the browser fires `beforeinstallprompt` once, often before hydration, so it
 * is kept on window for the banner. preventDefault stops Chrome's own mini bar; our banner replaces it.
 * `appinstalled` (any route) marks this browser as installed so the banner never comes back.
 */
export const installCaptureScript = `(function(){try{window.addEventListener("beforeinstallprompt",function(e){if(${STUDIO_RE}.test(location.pathname)&&window.matchMedia("(max-width: 1023px)").matches)e.preventDefault();window.__outllyInstall=e;window.dispatchEvent(new Event("outly:installable"))});window.addEventListener("appinstalled",function(){window.__outllyInstall=null;try{var k="${INSTALL_KEY}",s=JSON.parse(localStorage.getItem(k)||"{}");s.installed=true;localStorage.setItem(k,JSON.stringify(s))}catch(_){}window.dispatchEvent(new Event("outly:installed"))})}catch(_){}})();`;
