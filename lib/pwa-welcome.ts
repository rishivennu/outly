import { STUDIO_RE } from "./pwa-core";

/**
 * First launch from the Home Screen (1100). The first time Outlly opens installed (iPhone/iPad from the Home
 * Screen, Android Chrome/Edge/Samsung as an installed app), the studio opens on a short welcome with Get started.
 * Once per device: iOS gives a Home Screen app its own storage, so the key is naturally per install there.
 * Never inside the Android app (it has its own onboarding), never in a plain browser tab.
 *
 * Decided in <head> (welcomeScript) so the very first paint is the welcome, not a flash of the dashboard.
 * The studio renders the welcome on every load, hidden by CSS unless html[data-welcome] is set.
 * Other first-run popups (cookie choice, privacy notice, tour, offers) wait for it: welcomePending / afterWelcome.
 */
export interface WelcomeConfig {
  enabled: boolean;
  /** "{name}" becomes the person's first name. */
  title: string;
  body: string;
  /** Up to three short lines with a tick; empty lines are dropped. */
  points: string[];
  button: string;
}

export const WELCOME_DEFAULT: WelcomeConfig = {
  enabled: true,
  title: "Welcome, {name}.",
  body: "Outlly now lives on your Home Screen. Plan, post and reply from one place, one tap away.",
  points: ["Schedule once, post everywhere", "Every comment and DM in one inbox", "See what is working, every week"],
  button: "Get started",
};

export const WELCOME_LIMITS = { title: 60, body: 180, point: 48, button: 24, points: 3 } as const;

const text = (v: unknown, max: number, d: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : d);

export function normalizeWelcome(c: Partial<WelcomeConfig> | null | undefined): WelcomeConfig {
  const d = WELCOME_DEFAULT;
  const points = Array.isArray(c?.points)
    ? c.points.filter((p): p is string => typeof p === "string").map((p) => p.trim().slice(0, WELCOME_LIMITS.point)).filter(Boolean).slice(0, WELCOME_LIMITS.points)
    : d.points;
  return {
    enabled: typeof c?.enabled === "boolean" ? c.enabled : d.enabled,
    title: text(c?.title, WELCOME_LIMITS.title, d.title),
    body: text(c?.body, WELCOME_LIMITS.body, d.body),
    points,
    button: text(c?.button, WELCOME_LIMITS.button, d.button),
  };
}

/** "{name}" -> first name; without a name the placeholder and the comma before it go. */
export function fillName(s: string, name: string | null | undefined) {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? s.split("{name}").join(first) : s.replace(/,?\s*\{name\}/g, "").replace(/\s+([.!?])/g, "$1");
}

/** localStorage: set once Get started is pressed. */
export const WELCOME_KEY = "outlly:pwa-welcomed";
/** Fired on window when the welcome has gone; popups waiting on it go ahead. */
export const WELCOMED_EVENT = "outly:welcomed";

/** The same test the head script runs, for the client fallback (a soft navigation after signing in). */
export function shouldWelcome(o: { standalone: boolean; iosStandalone?: boolean; appMode: boolean; referrer?: string; path: string; seen: boolean }) {
  if (o.seen || o.appMode) return false;
  if ((o.referrer ?? "").startsWith("android-app://")) return false;
  if (!(o.standalone || o.iosStandalone)) return false;
  return STUDIO_RE.test(o.path);
}

/** How long the screen may wait for the page's JavaScript before the head script lifts it (no-JS way out). */
export const WELCOME_WATCHDOG_MS = 10_000;

/**
 * Runs after appScript (which marks the Android app) so data-app is already known. If the page never hydrates
 * (a failed chunk on a bad connection), the watchdog lifts the screen so nobody is stuck on a first launch;
 * PwaWelcome cancels it (window.__owT) the moment it hydrates.
 */
export const welcomeScript = `try{var d=document.documentElement,m=function(q){return window.matchMedia(q).matches};if(!d.hasAttribute("data-app")&&document.referrer.indexOf("android-app://")!==0&&(m("(display-mode: standalone)")||m("(display-mode: fullscreen)")||navigator.standalone===true)&&${STUDIO_RE}.test(location.pathname)&&!localStorage.getItem("${WELCOME_KEY}")){d.setAttribute("data-welcome","");window.__owT=setTimeout(function(){d.removeAttribute("data-welcome")},${WELCOME_WATCHDOG_MS})}}catch(e){}`;

/** The welcome is on screen (or about to be): the flag is set and the studio rendered it. */
export function welcomePending() {
  if (typeof document === "undefined") return false;
  return document.documentElement.hasAttribute("data-welcome") && !!document.querySelector("[data-pwa-welcome]");
}

/** Run `cb` once the welcome has gone (now, if there is none). Returns a cleanup. */
export function afterWelcome(cb: () => void) {
  if (!welcomePending()) {
    cb();
    return () => {};
  }
  window.addEventListener(WELCOMED_EVENT, cb, { once: true });
  return () => window.removeEventListener(WELCOMED_EVENT, cb);
}
