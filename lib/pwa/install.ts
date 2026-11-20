import { useSyncExternalStore } from "react";
import {
  INSTALL_DEFAULT,
  INSTALL_KEY,
  cooldownFor,
  dismiss,
  guided,
  installMode,
  isIOS,
  parseState,
  provenInstalled,
  runningInstalled,
  type InstallConfig,
  type InstallState,
} from "@/lib/pwa-core";

/**
 * R1256: one place that knows whether Outlly can be installed here, and how. The browser's prompt is caught in
 * <head> (installCaptureScript in lib/pwa-core.ts) and kept on window.__outllyInstall, so it outlives route
 * changes and hydration; this manager reads that slot, follows the install events and the display mode, and keeps
 * the dismissal memory (the same localStorage record as the 1099 card, so every surface shares one cool-down).
 * Installed only ever comes from the browser: a standalone display mode, iOS standalone, the Android app, or
 * `appinstalled`. Opening the guide never counts.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

export type Platform = "ios" | "android" | "desktop";
export type Browser = "safari" | "chrome" | "edge" | "firefox" | "samsung" | "other";
/** Which set of manual steps fits this browser when there is no prompt to call. */
export type GuideKind = "ios-safari" | "ios-other" | "android" | "desktop" | "desktop-safari" | "unsupported" | "in-app";
export type PromptOutcome = "accepted" | "dismissed" | "unavailable";

export interface InstallSnapshot {
  /** False on the server and before the first browser read: render nothing install-related yet. */
  ready: boolean;
  platform: Platform;
  /** iPad, including iPadOS 13+ that reports itself as a Mac. */
  tablet: boolean;
  browser: Browser;
  inApp: boolean;
  guide: GuideKind;
  /** The browser handed over its install prompt and it has not been used yet. */
  canPrompt: boolean;
  /** Running as the installed app right now. */
  standalone: boolean;
  /** Installed, as far as the browser has told us (running installed, or `appinstalled` on this browser). */
  installed: boolean;
  /** Not installed and no prompt: the button opens the manual steps. */
  needsGuide: boolean;
  /** The promotion was turned down recently (or too often): wait out the cool-down. */
  dismissed: boolean;
  /** The last native prompt's answer in this tab, null if none was shown. */
  outcome: "accepted" | "dismissed" | null;
  /** `appinstalled` fired in this tab: the moment for a short success message. */
  justInstalled: boolean;
  /** The manual steps are on screen (one shared sheet, so a menu that closes behind it does not take it along). */
  guideOpen: boolean;
}

export const SERVER_SNAPSHOT: InstallSnapshot = {
  ready: false,
  platform: "desktop",
  tablet: false,
  browser: "other",
  inApp: false,
  guide: "desktop",
  canPrompt: false,
  standalone: false,
  installed: false,
  needsGuide: false,
  dismissed: false,
  outcome: null,
  justInstalled: false,
  guideOpen: false,
};

export const isTablet = (ua: string, platform = "", maxTouchPoints = 0) => /iPad/i.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);

export function detectPlatform(ua: string, platform = "", maxTouchPoints = 0): Platform {
  if (isIOS(ua, platform, maxTouchPoints)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export function detectBrowser(ua: string): Browser {
  if (/EdgiOS|EdgA\/|Edg\//.test(ua)) return "edge";
  if (/FxiOS|Firefox\//.test(ua)) return "firefox";
  if (/SamsungBrowser/.test(ua)) return "samsung";
  if (/OPR\/|OPiOS|OPT\/|YaBrowser|Ddg\/|DuckDuckGo/.test(ua)) return "other";
  if (/CriOS|Chrome\/|Chromium\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

/** pwa-core's installMode answers null with a prompt in hand only inside another app's browser. */
export const isInAppBrowser = (ua: string) => installMode({ ua, hasPrompt: true }) === null;

export function guideKind(platform: Platform, browser: Browser, inApp: boolean): GuideKind {
  if (inApp) return "in-app";
  if (platform === "ios") return browser === "safari" ? "ios-safari" : "ios-other";
  if (platform === "android") return "android";
  if (browser === "safari") return "desktop-safari";
  if (browser === "firefox") return "unsupported";
  return "desktop";
}

const DAY = 86_400_000;

/** In the cool-down after "Not now" (doubling each time), or stopped for good after too many. */
export function inCooldown(s: InstallState, cfg: InstallConfig, now: number): boolean {
  if (s.dismissals >= cfg.maxDismissals) return true;
  return s.dismissals > 0 && now - s.dismissedAt < cooldownFor(s.dismissals, cfg) * DAY;
}

/** The parts of window the manager touches, so the tests can hand it a fake. */
export interface InstallWindow {
  navigator: { userAgent: string; platform?: string; maxTouchPoints?: number; standalone?: boolean };
  document: { documentElement: { hasAttribute: (n: string) => boolean }; referrer: string };
  location: { search: string };
  localStorage: Pick<Storage, "getItem" | "setItem">;
  matchMedia?: (q: string) => { matches: boolean; addEventListener?: (t: "change", f: () => void) => void; removeEventListener?: (t: "change", f: () => void) => void };
  addEventListener: (t: string, f: (e: Event) => void) => void;
  removeEventListener: (t: string, f: (e: Event) => void) => void;
  __outllyInstall?: BeforeInstallPromptEvent | null;
}

const DISPLAY_MODES = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];

export interface InstallManager {
  getSnapshot: () => InstallSnapshot;
  subscribe: (fn: () => void) => () => void;
  /** Call only from a click: shows the browser's own install prompt and reports the answer. */
  promptInstall: () => Promise<PromptOutcome>;
  /** "Not now" on a promotion: one strike, then the cool-down. */
  dismissPromotion: () => void;
  openGuide: () => void;
  /** The manual steps were read. We cannot see an iOS install, so this only pauses promotions; it never marks installed. */
  closeGuide: () => void;
  /** The cool-down rules the admin set (Admin > Dashboard), used by `dismissed`. */
  configure: (cfg: InstallConfig) => void;
  refresh: () => void;
  destroy: () => void;
}

export function createInstallManager(win: InstallWindow, now: () => number = Date.now): InstallManager {
  let cfg = INSTALL_DEFAULT;
  let outcome: InstallSnapshot["outcome"] = null;
  let justInstalled = false;
  let guideOpen = false;
  let snap: InstallSnapshot = SERVER_SNAPSHOT;
  let key = "";
  const listeners = new Set<() => void>();

  const read = (): InstallState => {
    try {
      return parseState(win.localStorage.getItem(INSTALL_KEY));
    } catch {
      return parseState(null);
    }
  };
  const write = (s: InstallState) => {
    try {
      win.localStorage.setItem(INSTALL_KEY, JSON.stringify(s));
    } catch {
      /* private mode: it may ask again next visit, nothing worse */
    }
  };
  const mm = (q: string) => {
    try {
      return win.matchMedia?.(q).matches ?? false;
    } catch {
      return false;
    }
  };
  const signals = () => ({
    standalone: DISPLAY_MODES.some((m) => mm(`(display-mode: ${m})`)),
    iosStandalone: win.navigator.standalone === true,
    appMode: win.document.documentElement.hasAttribute("data-app"),
    referrer: win.document.referrer,
    search: win.location.search,
  });

  const compute = (): InstallSnapshot => {
    const { userAgent: ua, platform: plat = "", maxTouchPoints: touch = 0 } = win.navigator;
    const platform = detectPlatform(ua, plat, touch);
    const browser = detectBrowser(ua);
    const inApp = isInAppBrowser(ua);
    const canPrompt = !!win.__outllyInstall && !inApp;
    const sig = signals();
    const proven = provenInstalled(sig);
    let stored = read();
    if (proven && !stored.installed) write((stored = { ...stored, installed: true }));
    // Browsers only offer the prompt for an app that is not installed: a stored "installed" is from before an uninstall.
    if (canPrompt && stored.installed && !proven) write((stored = { ...stored, installed: false }));
    const installed = runningInstalled(sig) || stored.installed;
    return {
      ready: true,
      platform,
      tablet: platform === "ios" && isTablet(ua, plat, touch),
      browser,
      inApp,
      guide: guideKind(platform, browser, inApp),
      canPrompt: canPrompt && !installed,
      standalone: proven,
      installed,
      needsGuide: !installed && !canPrompt,
      dismissed: inCooldown(stored, cfg, now()),
      outcome,
      justInstalled,
      guideOpen,
    };
  };

  const sync = () => {
    const next = compute();
    const k = JSON.stringify(next);
    if (k === key) return false;
    key = k;
    snap = next;
    return true;
  };
  const refresh = () => {
    if (sync()) listeners.forEach((f) => f());
  };

  const onInstalled = () => {
    justInstalled = true;
    win.__outllyInstall = null;
    const s = read();
    if (!s.installed) write({ ...s, installed: true });
    refresh();
  };
  // The head script normally keeps the event; this covers a page where it did not run (it leaves Chrome's own bar alone).
  const onPrompt = (e: Event) => {
    if (!win.__outllyInstall) win.__outllyInstall = e as BeforeInstallPromptEvent;
    refresh();
  };
  const mql = (() => {
    try {
      return win.matchMedia?.("(display-mode: standalone)");
    } catch {
      return undefined;
    }
  })();
  win.addEventListener("beforeinstallprompt", onPrompt);
  win.addEventListener("outly:installable", refresh);
  win.addEventListener("appinstalled", onInstalled);
  win.addEventListener("outly:installed", onInstalled);
  win.addEventListener("storage", refresh);
  mql?.addEventListener?.("change", refresh);

  return {
    getSnapshot: () => {
      if (!snap.ready) sync();
      return snap;
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    promptInstall: async () => {
      const ev = win.__outllyInstall;
      if (!ev) {
        refresh();
        return "unavailable";
      }
      // A prompt can be shown once; the browser fires a fresh one later if it is still installable.
      win.__outllyInstall = null;
      try {
        await ev.prompt();
        const choice = await ev.userChoice;
        outcome = choice.outcome;
        if (choice.outcome === "dismissed") write(dismiss(read(), now()));
        refresh();
        return choice.outcome;
      } catch {
        refresh();
        return "unavailable";
      }
    },
    dismissPromotion: () => {
      write(dismiss(read(), now()));
      refresh();
    },
    openGuide: () => {
      guideOpen = true;
      refresh();
    },
    closeGuide: () => {
      if (!guideOpen) return;
      guideOpen = false;
      write(guided(read(), now()));
      refresh();
    },
    configure: (c) => {
      cfg = c;
      refresh();
    },
    refresh,
    destroy: () => {
      win.removeEventListener("beforeinstallprompt", onPrompt);
      win.removeEventListener("outly:installable", refresh);
      win.removeEventListener("appinstalled", onInstalled);
      win.removeEventListener("outly:installed", onInstalled);
      win.removeEventListener("storage", refresh);
      mql?.removeEventListener?.("change", refresh);
      listeners.clear();
    },
  };
}

let shared: InstallManager | null = null;
export function installManager(): InstallManager | null {
  if (typeof window === "undefined") return null;
  return (shared ??= createInstallManager(window as unknown as InstallWindow));
}

const noSub = () => () => {};
const server = () => SERVER_SNAPSHOT;

export function useInstallState(): InstallSnapshot {
  const m = installManager();
  return useSyncExternalStore(m?.subscribe ?? noSub, m?.getSnapshot ?? server, server);
}
