import { STUDIO_RE } from "./pwa-core";

/**
 * The studio welcome (1100, every entry since 1142). Each time someone comes into Outlly (a new tab, a cold
 * launch of the installed app or the Android app, signing in) the studio opens on a short welcome that greets
 * them by the time of day on their own clock ("Good morning, Maya."). Once per entry: sessionStorage remembers it
 * for the rest of that tab or app run, so moving between pages or reloading never brings it back. A tab opened
 * from inside the studio (a link to a post) is the same visit, not a new entry, so it doesn't greet again.
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
  /** Up to three short lines with a tick; empty lines are dropped. Not shown since the 1101 redesign (kept so saved settings still load). */
  points: string[];
  /** The primary action: closes the welcome onto the page it opened on. */
  button: string;
  /** 1101: secondary actions and the text link. */
  connect: string;
  tour: string;
  skip: string;
}

export const WELCOME_DEFAULT: WelcomeConfig = {
  enabled: true,
  title: "{greeting}, {name}. Let's get to it.",
  body: "Plan, post and reply from one place.",
  points: ["Schedule once, post everywhere", "Every comment and DM in one inbox", "See what is working, every week"],
  button: "Get started",
  connect: "Connect an account",
  tour: "Take the 1-minute tour",
  skip: "Skip to my dashboard",
};

/** The pre-1101 default headline: a saved copy of it follows the new default instead of pinning the old words. */
export const WELCOME_OLD_TITLE = "Welcome, {name}.";
/** 1142: earlier defaults that a saved copy may still hold. They follow the new default (the time-of-day greeting). */
export const WELCOME_OLD_TITLES = [WELCOME_OLD_TITLE, "Welcome! Let's get to it."];
export const WELCOME_OLD_BODIES = ["Outlly now lives on your Home Screen. Plan, post and reply from one place, one tap away."];

/** 1142: the greeting for an hour on the person's own clock (0-23). Morning 5-11, afternoon 12-16, evening the rest. */
export function greetingFor(hour: number) {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  return h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 17 ? "Good afternoon" : "Good evening";
}

/** "{greeting}" becomes the time-of-day greeting. A headline without it is the admin's own words and stays as written. */
export function fillGreeting(s: string, hour: number) {
  return s.split("{greeting}").join(greetingFor(hour));
}

export const WELCOME_LIMITS = { title: 60, body: 180, point: 48, button: 24, points: 3, connect: 28, tour: 28, skip: 28 } as const;

const text = (v: unknown, max: number, d: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : d);

export function normalizeWelcome(c: Partial<WelcomeConfig> | null | undefined): WelcomeConfig {
  const d = WELCOME_DEFAULT;
  const points = Array.isArray(c?.points)
    ? c.points.filter((p): p is string => typeof p === "string").map((p) => p.trim().slice(0, WELCOME_LIMITS.point)).filter(Boolean).slice(0, WELCOME_LIMITS.points)
    : d.points;
  return {
    enabled: typeof c?.enabled === "boolean" ? c.enabled : d.enabled,
    title: typeof c?.title === "string" && WELCOME_OLD_TITLES.includes(c.title.trim()) ? d.title : text(c?.title, WELCOME_LIMITS.title, d.title),
    body: typeof c?.body === "string" && WELCOME_OLD_BODIES.includes(c.body.trim()) ? d.body : text(c?.body, WELCOME_LIMITS.body, d.body),
    points,
    button: text(c?.button, WELCOME_LIMITS.button, d.button),
    connect: text(c?.connect, WELCOME_LIMITS.connect, d.connect),
    tour: text(c?.tour, WELCOME_LIMITS.tour, d.tour),
    skip: text(c?.skip, WELCOME_LIMITS.skip, d.skip),
  };
}

/**
 * The headline as lines to set (1101): one line per sentence, so "Welcome! Let's get to it." breaks after
 * "Welcome!" and never inside a sentence on a phone. The last word is the lime highlight.
 * A sentence too long for one line (over 22 characters) is allowed to wrap.
 */
export function headlineParts(s: string): { lines: string[]; tail: string; hl: string } {
  const sents = s.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const last = sents.pop() ?? "";
  const i = last.lastIndexOf(" ");
  return { lines: sents, tail: i < 0 ? "" : last.slice(0, i), hl: i < 0 ? last : last.slice(i + 1) };
}

/** Lines short enough to keep whole (no break inside them). */
export const HEADLINE_NOWRAP = 22;

/** "{name}" -> first name; without a name the placeholder and the comma before it go. */
export function fillName(s: string, name: string | null | undefined) {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? s.split("{name}").join(first) : s.replace(/,?\s*\{name\}/g, "").replace(/\s+([.!?])/g, "$1");
}

/** localStorage: when the welcome was last closed on this device (kept for reference; it no longer stops it). */
export const WELCOME_KEY = "outlly:pwa-welcomed";
/** 1142: sessionStorage, set when this entry's welcome is closed. A new tab or a new app launch starts without it. */
export const WELCOME_SESSION_KEY = "outlly:welcomed-entry";
/** Fired on window when the welcome has gone; popups waiting on it go ahead. */
export const WELCOMED_EVENT = "outly:welcomed";

/** A tab opened from a studio page of this same site: still the same visit, so no second greeting. */
export function fromInsideStudio(referrer: string | undefined, origin: string) {
  if (!referrer || !origin || !referrer.startsWith(origin + "/")) return false;
  try {
    return STUDIO_RE.test(new URL(referrer).pathname);
  } catch {
    return false;
  }
}

/** The same test the head script runs, for the client fallback (a soft navigation after signing in). */
export function shouldWelcome(o: { path: string; seen: boolean; referrer?: string; origin?: string }) {
  if (o.seen) return false;
  if (fromInsideStudio(o.referrer, o.origin ?? "")) return false;
  return STUDIO_RE.test(o.path);
}

/** How long the screen may wait for the page's JavaScript before the head script lifts it (no-JS way out). */
export const WELCOME_WATCHDOG_MS = 10_000;

/**
 * Decides before the first paint, so an entry paints the welcome, not a flash of the dashboard. If the page never
 * hydrates (a failed chunk on a bad connection), the watchdog lifts the screen so nobody is stuck on it;
 * PwaWelcome cancels it (window.__owT) the moment it hydrates. Storage blocked: no welcome (it could never be closed for good).
 */
export const welcomeScript = `try{var d=document.documentElement,r=document.referrer,o=location.origin,i=false;try{i=!!r&&r.indexOf(o+"/")===0&&${STUDIO_RE}.test(new URL(r).pathname)}catch(e){}if(!i&&${STUDIO_RE}.test(location.pathname)&&!sessionStorage.getItem("${WELCOME_SESSION_KEY}")){d.setAttribute("data-welcome","");window.__owT=setTimeout(function(){d.removeAttribute("data-welcome")},${WELCOME_WATCHDOG_MS})}}catch(e){}`;

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
