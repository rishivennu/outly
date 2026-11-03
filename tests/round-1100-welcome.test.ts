/** 1100: first launch from the Home Screen gets a welcome, once per device, before any other popup. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { WELCOME_DEFAULT, WELCOME_KEY, fillName, normalizeWelcome, shouldWelcome, welcomeScript } from "../lib/pwa-welcome";

const src = (p: string) => readFileSync(p, "utf8");
const w = src("components/shell/PwaWelcome.tsx");
const css = src("app/globals.css");
const base = { standalone: true, appMode: false, referrer: "", path: "/home", seen: false };

describe("1100 when the welcome shows", () => {
  test("installed launch on a studio page, first time only", () => {
    expect(shouldWelcome(base)).toBe(true);
    expect(shouldWelcome({ ...base, standalone: false, iosStandalone: true })).toBe(true);
    expect(shouldWelcome({ ...base, seen: true })).toBe(false);
    expect(shouldWelcome({ ...base, standalone: false })).toBe(false); // a browser tab
    expect(shouldWelcome({ ...base, path: "/login" })).toBe(false);
  });
  test("never inside the Android app", () => {
    expect(shouldWelcome({ ...base, appMode: true })).toBe(false);
    expect(shouldWelcome({ ...base, referrer: "android-app://com.outlly.app/" })).toBe(false);
  });
  test("head script: same rules, before paint, after appScript in the root layout", () => {
    for (const s of ['hasAttribute("data-app")', "android-app://", "(display-mode: standalone)", "navigator.standalone===true", `localStorage.getItem("${WELCOME_KEY}")`, 'setAttribute("data-welcome","")']) expect(welcomeScript).toContain(s);
    const layout = src("app/layout.tsx");
    expect(layout.indexOf("__html: welcomeScript")).toBeGreaterThan(layout.indexOf("__html: appScript"));
    expect(src("app/(studio)/layout.tsx")).toContain("{welcomeCfg.enabled && <PwaWelcome config={welcomeCfg} />}");
  });
});

describe("1100 welcome screen", () => {
  test("hidden unless flagged, and a dialog only while it shows (others look for [role=dialog])", () => {
    expect(css).toMatch(/\.pwa-welcome \{ display: none; \}/);
    expect(css).toMatch(/html\[data-welcome\] \.pwa-welcome \{/);
    expect(w).toContain('role={live ? "dialog" : undefined}');
    expect(w).toContain('aria-labelledby="pw-title"');
  });
  test("Get started remembers it, then hands over; focus stays inside while up", () => {
    expect(w).toContain("localStorage.setItem(WELCOME_KEY");
    expect(w).toContain("window.dispatchEvent(new Event(WELCOMED_EVENT))");
    expect(w).toMatch(/e\.key === "Tab"[\s\S]{0,700}preventDefault/); // 1101: a cycle over the screen's controls
  });
  test("safe areas, scroll lock, reduced motion, 56px button", () => {
    for (const s of ["top", "right", "bottom", "left"]) expect(css).toContain(`env(safe-area-inset-${s})`);
    expect(css).toMatch(/html\[data-welcome\]:has\(\[data-pwa-welcome\]\) body \{ overflow: hidden; \}/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*html\[data-welcome\] \.pwa-welcome \{ animation: page-fade/);
    expect(css).toMatch(/\.pw-cta \{[^}]*height: 56px/);
  });
  test("other first-run popups wait for it", () => {
    expect(src("components/shared/CookieConsent.tsx")).toContain("afterWelcome(() => setShow(true))");
    const p = src("components/shared/PrivacyNotice.tsx");
    expect(p).toMatch(/export function afterPrivacy[\s\S]{0,200}welcomePending\(\)/);
    expect(p).toContain("if (welcomePending()) return;");
  });
});

describe("1100 welcome config (Admin > Dashboard style)", () => {
  test("defaults, limits and junk", () => {
    expect(normalizeWelcome(null)).toEqual(WELCOME_DEFAULT);
    const n = normalizeWelcome({ enabled: false, title: "  x ".repeat(40), points: ["a", "", 3 as unknown as string, "b", "c", "d"], button: "" });
    expect(n.enabled).toBe(false);
    expect(n.title.length).toBeLessThanOrEqual(60);
    expect(n.points).toEqual(["a", "b", "c"]);
    expect(n.button).toBe(WELCOME_DEFAULT.button);
    expect(normalizeWelcome({ points: [] }).points).toEqual([]);
  });
  test("{name} fills in, or drops cleanly", () => {
    expect(fillName("Welcome, {name}.", "Maya Rao")).toBe("Welcome, Maya.");
    expect(fillName("Welcome, {name}.", "")).toBe("Welcome.");
    expect(fillName("Hi {name}!", null)).toBe("Hi!");
  });
  test("admin route validates and the card is on the page", () => {
    const r = src("app/api/admin/welcome/route.ts");
    expect(r).toContain('adminRoute("site"');
    expect(r).toContain(".strict()");
    expect(src("app/admin/(panel)/dashboard/page.tsx")).toContain("<WelcomeScreenSettings initial={welcome} />");
  });
});
