/**
 * 1099: mobile shell. The Add to Home Screen rules (who is asked, when, how often), the head script that keeps
 * the browser's install prompt, the PWA basics it depends on, and source checks on the phone top bar (no box,
 * safe areas, 44px buttons) and the touch-target fixes.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  EMPTY_STATE,
  STUDIO_RE,
  guided,
  provenInstalled,
  INSTALL_DEFAULT,
  INSTALL_KEY,
  cooldownFor,
  dismiss,
  installCaptureScript,
  installMode,
  isCalmPage,
  isIOS,
  normalizeInstall,
  parseState,
  runningInstalled,
  shouldOffer,
} from "../lib/pwa-core";
import manifest from "../app/manifest";

const DAY = 86_400_000;
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iosChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
  ipadAsMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0",
  fbAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0]",
  desktopFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
};

describe("1099 install rules", () => {
  const cfg = INSTALL_DEFAULT;
  const now = Date.UTC(2026, 10, 3);

  test("defaults: on, from the 2nd visit, 20 s of quiet, 21-day cooldown, 3 strikes", () => {
    expect(cfg).toEqual({ enabled: true, minVisits: 2, delaySec: 20, cooldownDays: 21, maxDismissals: 3 });
  });

  test("normalize clamps and fills in", () => {
    expect(normalizeInstall(null)).toEqual(cfg);
    expect(normalizeInstall({ minVisits: 0, delaySec: 9999, cooldownDays: -3, maxDismissals: 2.6, enabled: false })).toEqual({ enabled: false, minVisits: 1, delaySec: 120, cooldownDays: 1, maxDismissals: 3 });
    expect(normalizeInstall({ minVisits: "3" as unknown as number }).minVisits).toBe(2);
  });

  test("never on the first visit, yes on the second", () => {
    expect(shouldOffer({ ...EMPTY_STATE, visits: 1 }, cfg, now)).toBe(false);
    expect(shouldOffer({ ...EMPTY_STATE, visits: 2 }, cfg, now)).toBe(true);
  });

  test("off, or installed: never", () => {
    expect(shouldOffer({ ...EMPTY_STATE, visits: 9 }, { ...cfg, enabled: false }, now)).toBe(false);
    expect(shouldOffer({ ...EMPTY_STATE, visits: 9, installed: true }, cfg, now)).toBe(false);
  });

  test("Not now waits the cooldown, doubled each time, then stops for good", () => {
    let s = { ...EMPTY_STATE, visits: 5 };
    s = dismiss(s, now);
    expect(s).toEqual({ visits: 5, dismissals: 1, dismissedAt: now, guidedAt: 0, installed: false });
    expect(shouldOffer(s, cfg, now + 20 * DAY)).toBe(false);
    expect(shouldOffer(s, cfg, now + 21 * DAY)).toBe(true);
    s = dismiss(s, now);
    expect(cooldownFor(2, cfg)).toBe(42);
    expect(shouldOffer(s, cfg, now + 41 * DAY)).toBe(false);
    expect(shouldOffer(s, cfg, now + 42 * DAY)).toBe(true);
    s = dismiss(s, now);
    expect(shouldOffer(s, cfg, now + 10_000 * DAY)).toBe(false);
    expect(cooldownFor(0, cfg)).toBe(0);
  });

  test("stored state survives junk", () => {
    expect(parseState(null)).toEqual(EMPTY_STATE);
    expect(parseState("{nope")).toEqual(EMPTY_STATE);
    expect(parseState(JSON.stringify({ visits: -4, dismissals: "x", dismissedAt: 12.7, installed: "yes" }))).toEqual({ visits: 0, dismissals: 0, dismissedAt: 12, guidedAt: 0, installed: false });
    expect(parseState(JSON.stringify({ visits: 3, dismissals: 1, dismissedAt: 5, installed: true }))).toEqual({ visits: 3, dismissals: 1, dismissedAt: 5, guidedAt: 0, installed: true });
  });

  test("calm pages only: never Create, editors, billing or settings", () => {
    for (const p of ["/home", "/home/", "/calendar", "/content", "/analytics", "/inbox"]) expect(isCalmPage(p)).toBe(true);
    for (const p of ["/create", "/create/bulk", "/content/abc", "/billing", "/settings", "/accounts", "/support"]) expect(isCalmPage(p)).toBe(false);
  });
});

describe("1099 platform detection", () => {
  test("Android with the browser prompt gets the native prompt", () => {
    expect(installMode({ ua: UA.android, hasPrompt: true })).toBe("prompt");
  });
  test("Android without a prompt (Firefox, or already installed): nothing", () => {
    expect(installMode({ ua: UA.android, hasPrompt: false })).toBe(null);
    expect(installMode({ ua: UA.desktopFirefox, hasPrompt: false })).toBe(null);
  });
  test("iPhone Safari, iOS Chrome and iPadOS (Mac UA + touch) get the steps", () => {
    expect(installMode({ ua: UA.iphone, hasPrompt: false })).toBe("ios");
    expect(installMode({ ua: UA.iosChrome, hasPrompt: false })).toBe("ios");
    expect(installMode({ ua: UA.ipadAsMac, platform: "MacIntel", maxTouchPoints: 5, hasPrompt: false })).toBe("ios");
    expect(isIOS(UA.ipadAsMac, "MacIntel", 0)).toBe(false); // a real Mac
  });
  test("in-app browsers can't install: never asked, even with a prompt", () => {
    expect(installMode({ ua: UA.instagram, hasPrompt: false })).toBe(null);
    expect(installMode({ ua: UA.fbAndroid, hasPrompt: true })).toBe(null);
  });
  test("already installed: standalone, iOS standalone, the Android app, TWA referrer, ?source=pwa", () => {
    const base = { standalone: false, iosStandalone: false, appMode: false, referrer: "", search: "" };
    expect(runningInstalled(base)).toBe(false);
    expect(runningInstalled({ ...base, standalone: true })).toBe(true);
    expect(runningInstalled({ ...base, iosStandalone: true })).toBe(true);
    expect(runningInstalled({ ...base, appMode: true })).toBe(true);
    expect(runningInstalled({ ...base, referrer: "android-app://com.outlly.app/" })).toBe(true);
    expect(runningInstalled({ ...base, search: "?source=pwa" })).toBe(true);
    expect(runningInstalled({ ...base, search: "?source=email" })).toBe(false);
  });
});

describe("1099 head script", () => {
  test("keeps the prompt, stops Chrome's mini bar, marks installs", () => {
    const listeners: Record<string, (e: any) => void> = {};
    const store = new Map<string, string>();
    const fired: string[] = [];
    const win: any = {
      addEventListener: (n: string, f: (e: any) => void) => (listeners[n] = f),
      dispatchEvent: (e: { type: string }) => fired.push(e.type),
      matchMedia: () => ({ matches: true }),
    };
    const loc = { pathname: "/home" };
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
    class Ev { constructor(public type: string) {} }
    new Function("window", "localStorage", "Event", "location", installCaptureScript)(win, ls, Ev, loc);
    let prevented = false;
    // On a marketing page the browser keeps its own install bar, but we still hold the event.
    loc.pathname = "/pricing";
    listeners.beforeinstallprompt({ preventDefault: () => (prevented = true) });
    expect(prevented).toBe(false);
    loc.pathname = "/home";
    const e = { preventDefault: () => (prevented = true) };
    listeners.beforeinstallprompt(e);
    expect(prevented).toBe(true);
    expect(win.__outllyInstall).toBe(e);
    expect(fired).toContain("outly:installable");
    store.set(INSTALL_KEY, JSON.stringify({ visits: 3, dismissals: 1, dismissedAt: 9 }));
    listeners.appinstalled({});
    expect(win.__outllyInstall).toBe(null);
    expect(parseState(store.get(INSTALL_KEY))).toEqual({ visits: 3, dismissals: 1, dismissedAt: 9, guidedAt: 0, installed: true });
    expect(fired).toContain("outly:installed");
  });
  test("root layout runs it with the CSP nonce, and iOS web-app metadata is set", () => {
    const l = src("app/layout.tsx");
    expect(l).toContain("<script nonce={nonce} dangerouslySetInnerHTML={{ __html: installCaptureScript }} />");
    expect(l).toMatch(/appleWebApp: \{ capable: true, title: "Outlly"/);
  });
});

describe("1099 PWA basics the banner relies on", () => {
  const m = manifest();
  test("manifest: standalone, start URL marks the PWA, 192 + 512 + maskable icons on disk", () => {
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/home?source=pwa");
    const icons = m.icons ?? [];
    expect(icons.some((i) => i.sizes === "192x192")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "any")).toBe(true);
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const i of icons) expect(existsSync(new URL(`../public${i.src}`, import.meta.url))).toBe(true);
    expect(existsSync(new URL("../app/apple-icon.png", import.meta.url))).toBe(true);
  });
  test("service worker has a fetch handler and is registered", () => {
    expect(src("public/sw.js")).toMatch(/addEventListener\("fetch"/);
    expect(src("components/shared/Connectivity.tsx")).toContain('navigator.serviceWorker.register("/sw.js")');
  });
  test("studio mounts the card with the admin config; admin route validates", () => {
    expect(src("app/(studio)/layout.tsx")).toContain("<InstallPrompt config={normalizeInstall(install)} />");
    const r = src("app/api/admin/install/route.ts");
    expect(r).toContain('adminRoute("site"');
    expect(r).toContain(".strict()");
    expect(src("lib/settings.ts")).toContain("install: INSTALL_DEFAULT");
  });
  test("the card: not a dialog, phones only, hidden in the Android app, dismissible, iOS steps", () => {
    const c = src("components/shell/InstallPrompt.tsx");
    expect(c).toContain('aria-label="Install Outlly"');
    expect(c).toContain("web-only fixed");
    expect(c).toContain("lg:hidden");
    expect(c).toContain('aria-label="Not now"');
    expect(c).toContain("Add to Home Screen");
    expect(c).toContain("Tap the Share button");
    expect(c).toContain("Add to Home Screen\\u201d");
    expect(c).toContain("Tap \\u201cAdd\\u201d");
    expect(c).not.toMatch(/<motion\.aside[^>]*role="dialog"/);
  });
});

describe("1099 phone top bar and touch targets", () => {
  const nav = src("components/shell/Nav.tsx");
  const bar = nav.slice(nav.indexOf("export function MobileTopBar"));
  const css = src("app/globals.css");
  test("no box at rest: no border, solid fill or shadow classes on the header", () => {
    expect(bar).toContain('className="mtop web-only sticky top-0 z-30 lg:hidden"');
    expect(bar).not.toMatch(/border-b|bg-background|shadow-\[/);
    expect(css).toMatch(/\.mtop\[data-lifted\] \{[^}]*backdrop-filter/);
  });
  test("safe areas on three sides and a shorter row in landscape", () => {
    for (const side of ["top", "left", "right"]) expect(css).toContain(`padding-${side}: env(safe-area-inset-${side});`);
    expect(css).toMatch(/@media \(orientation: landscape\) and \(max-height: 500px\) \{\s*\.mtop-row \{ height: 48px; \}/);
  });
  test("every control is a 44px .mtop-btn with press feedback and a reduced-motion fallback", () => {
    // 1103: search, theme, notifications, menu
    expect(bar.match(/className="mtop-btn"/g)?.length).toBe(4);
    expect(css).toMatch(/\.mtop-btn \{[^}]*width: 44px; height: 44px;/);
    expect(css).toMatch(/\.mtop-btn:active \{ transform: scale\(0\.9\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.mtop, \.mtop-btn \{ transition: none; \}/);
    expect(bar).toContain("min-w-11");
  });
  test("segmented controls get a 44px hit area; the analytics range fits a 360px phone", () => {
    expect(src("components/home/DashboardSwitch.tsx")).toContain("before:-inset-y-1");
    expect(src("components/dashboard/PulseHome.tsx")).toContain("before:-inset-y-1");
    const a = src("components/analytics/AnalyticsView.tsx");
    expect(a).toContain('<span className="sm:hidden">More</span>');
    expect(a).toContain('aria-label="More history"');
    expect(src("components/calendar/CalendarView.tsx").match(/max-lg:h-11/g)?.length).toBe(2);
  });
});

describe("1099 review fixes", () => {
  test("iOS walkthrough pauses one cooldown and is not a strike", () => {
    const now = Date.now();
    const s = guided({ ...EMPTY_STATE, visits: 5 }, now);
    expect(s.dismissals).toBe(0);
    expect(shouldOffer(s, INSTALL_DEFAULT, now + 86_400_000)).toBe(false);
    expect(shouldOffer(s, INSTALL_DEFAULT, now + 22 * 86_400_000)).toBe(true);
  });
  test("?source=pwa hides the card for the load but is never remembered", () => {
    const sig = { standalone: false, appMode: false, search: "?source=pwa" };
    expect(runningInstalled(sig)).toBe(true);
    expect(provenInstalled(sig)).toBe(false);
    expect(provenInstalled({ ...sig, standalone: true })).toBe(true);
  });
  test("Chrome's own install bar is only held back on studio routes", () => {
    expect(STUDIO_RE.test("/home")).toBe(true);
    expect(STUDIO_RE.test("/content/abc")).toBe(true);
    expect(STUDIO_RE.test("/pricing")).toBe(false);
    expect(STUDIO_RE.test("/homepage")).toBe(false);
    expect(installCaptureScript).toContain("max-width: 1023px");
    expect(() => new Function(installCaptureScript)).not.toThrow();
  });
  test("event names follow the outly: convention the tour and guide use", () => {
    const src = readFileSync("components/shell/InstallPrompt.tsx", "utf8");
    expect(src).not.toMatch(/"outlly:(tour|guide|installable|installed)"/);
    expect(src).toContain('"outly:tour"');
  });
});
