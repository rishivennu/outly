/** R1291: the "Meet your new Outlly dock" card, the account-level UI prefs behind it, and the pick order. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NAV_INTRO_VERSION, introEligible, parseUiPrefs, resolveNav, serializeUiPrefs, type UiPrefs } from "../lib/nav-config";

const read = (p: string) => readFileSync(p, "utf8");
const intro = read("components/shell/NavIntro.tsx");
const layout = read("app/(studio)/layout.tsx");
const introRoute = read("app/api/me/nav/intro/route.ts");
const meRoute = read("app/api/me/nav/route.ts");
const auth = read("lib/auth.ts");
const schema = read("prisma/schema.prisma");
const template = read("prisma/schema.template.prisma");
const trackSrc = read("lib/analytics/track.ts");
const navStyle = read("lib/nav-style.ts");
const provider = read("components/shell/NavStyleProvider.tsx");

const at = "2026-11-21T00:00:00.000Z";
const ok = (prefs: UiPrefs, style: "sidebar" | "dock" = "sidebar", canSwitch = true) => introEligible({ style, canSwitch, prefs });

describe("R1291 introEligible", () => {
  test("sidebar, switching allowed, nothing remembered: eligible", () => {
    expect(ok({ v: 1 })).toBe(true);
  });
  test("already on the dock: not eligible", () => {
    expect(ok({ v: 1 }, "dock")).toBe(false);
  });
  test("admin locked the style: not eligible", () => {
    expect(ok({ v: 1 }, "sidebar", false)).toBe(false);
  });
  test("tried the dock once before: never again", () => {
    expect(ok({ v: 1, navTried: true })).toBe(false);
  });
  test("saved pick is the dock: not eligible", () => {
    expect(ok({ v: 1, nav: "dock" })).toBe(false);
  });
  test("answered this version's card either way: not eligible", () => {
    expect(ok({ v: 1, navIntro: { v: NAV_INTRO_VERSION, state: "dismissed", at } })).toBe(false);
    expect(ok({ v: 1, navIntro: { v: NAV_INTRO_VERSION, state: "tried", at } })).toBe(false);
  });
  test("answered an older version: eligible again", () => {
    expect(ok({ v: 1, navIntro: { v: NAV_INTRO_VERSION - 1, state: "dismissed", at } })).toBe(true);
    expect(ok({ v: 1, nav: "sidebar", navIntro: { v: 0, state: "dismissed", at } })).toBe(true);
  });
});

describe("R1291 parseUiPrefs / serializeUiPrefs", () => {
  test("empty or garbage becomes { v: 1 }", () => {
    for (const raw of [null, undefined, "", "not json", "[", "42", "null", '"x"']) expect(parseUiPrefs(raw)).toEqual({ v: 1 });
  });
  test("keeps nav, navTried and navIntro", () => {
    const p = parseUiPrefs(JSON.stringify({ v: 1, nav: "dock", navTried: true, navIntro: { v: 1, state: "tried", at } }));
    expect(p).toEqual({ v: 1, nav: "dock", navTried: true, navIntro: { v: 1, state: "tried", at } });
  });
  test("drops a bad nav value and unknown keys", () => {
    expect(parseUiPrefs(JSON.stringify({ v: 1, nav: "rail", theme: "dark", navTried: "yes" }))).toEqual({ v: 1 });
  });
  test("drops a navIntro with a bad state or version", () => {
    expect(parseUiPrefs(JSON.stringify({ navIntro: { v: 1, state: "maybe", at } }))).toEqual({ v: 1 });
    expect(parseUiPrefs(JSON.stringify({ navIntro: { v: "1", state: "tried", at } }))).toEqual({ v: 1 });
  });
  test("navIntro without a date keeps an empty one", () => {
    expect(parseUiPrefs(JSON.stringify({ navIntro: { v: 1, state: "dismissed" } })).navIntro).toEqual({ v: 1, state: "dismissed", at: "" });
  });
  test("serialize round-trips and always writes v: 1", () => {
    const p: UiPrefs = { v: 1, nav: "sidebar", navTried: true, navIntro: { v: 1, state: "dismissed", at } };
    expect(parseUiPrefs(serializeUiPrefs(p))).toEqual(p);
    expect(JSON.parse(serializeUiPrefs({ v: 7 } as unknown as UiPrefs)).v).toBe(1);
  });
});

describe("R1291 resolveNav order", () => {
  const open = { style: "sidebar" as const, userSwitch: true };
  test("the saved pick beats the cookie", () => {
    expect(resolveNav(open, "sidebar", "dock")).toBe("dock");
    expect(resolveNav({ style: "dock", userSwitch: true }, "dock", "sidebar")).toBe("sidebar");
  });
  test("the cookie beats the default when nothing is saved", () => {
    expect(resolveNav(open, "dock", null)).toBe("dock");
    expect(resolveNav(open, "dock")).toBe("dock");
  });
  test("a locked workspace ignores both", () => {
    expect(resolveNav({ style: "sidebar", userSwitch: false }, "dock", "dock")).toBe("sidebar");
    expect(resolveNav({ style: "dock", userSwitch: false }, "sidebar", "sidebar")).toBe("dock");
  });
  test("a junk saved value falls through to the cookie, then the default", () => {
    expect(resolveNav(open, "dock", "rail" as never)).toBe("dock");
    expect(resolveNav(open, "junk", "rail" as never)).toBe("sidebar");
  });
});

describe("R1291 NavIntro card", () => {
  test("exact copy", () => {
    for (const s of ["Meet your new Outlly dock", "Try the updated navigation for a cleaner, smoother experience.", "Try New Dock", "Maybe Later"]) expect(intro).toContain(s);
    expect(intro).not.toContain("\u2014");
  });
  test("a labelled region, never a dialog", () => {
    expect(intro).toContain('role="region"');
    expect(intro).toContain('aria-label="Meet your new Outlly dock"');
    expect(intro).not.toContain(' role="dialog"');
  });
  test("once per visit, desktop only, after 2500 ms, behind other popups", () => {
    expect(intro).toContain("`outlly:nav-intro:v${NAV_INTRO_VERSION}`");
    expect(intro).toContain("sessionStorage");
    expect(intro).toContain("2500");
    expect(intro).toContain("4000");
    expect(intro).toContain("30_000");
    expect(intro).toContain(`'[role="dialog"],[role="alertdialog"],[aria-labelledby="cc-title"]'`);
    expect(intro).toContain("dataset.onboarding");
    expect(intro).toContain('matchMedia("(min-width: 1024px)")');
    expect(intro).toContain("hidden lg:block");
  });
  test("analytics events", () => {
    expect(intro).toContain('track("nav_intro_shown", { style })');
    expect(intro).toContain('track("nav_intro_try", { from: style })');
    expect(intro).toContain('track("nav_intro_later", {})');
  });
  test("actions go through the provider", () => {
    expect(intro).toContain("useNavStyle()");
    expect(intro).toContain('set("dock", "intro")');
    expect(intro).toContain('introDone("tried")');
    expect(intro).toContain('introDone("dismissed")');
    expect(intro).toContain('e.key === "Escape"');
  });
  test("motion via usePanelPresence, no raw springs, layered between the dock and dialogs", () => {
    expect(intro).toContain('usePanelPresence(showing, card, PANEL.rise, "100% 100%")');
    expect(intro).toContain("createPortal");
    expect(intro).toContain("z-[60]");
    expect(intro).not.toContain("stiffness:");
    expect(intro).not.toContain("bounce:");
  });
  test("the studio layout renders it", () => {
    expect(layout).toContain("<NavIntro />");
  });
});

describe("R1291 plumbing pins", () => {
  test("intro route remembers the answer for this version", () => {
    expect(introRoute).toContain('z.enum(["dismissed", "tried"])');
    expect(introRoute).toContain("NAV_INTRO_VERSION");
    expect(introRoute).toContain("patchUiPrefs");
  });
  test("nav route saves to the account and marks the dock as tried", () => {
    expect(meRoute).toContain("patchUiPrefs");
    expect(meRoute).toContain('style === "dock" ? { navTried: true }');
  });
  test("auth reads uiPrefs and keeps the real person's under a seat", () => {
    expect(auth).toMatch(/USER_SELECT = \{[^}]*uiPrefs: true/);
    expect(auth).toContain("uiPrefs: me.uiPrefs");
  });
  test("both schemas carry the column", () => {
    expect(schema).toContain("uiPrefs      String?");
    expect(template).toContain("uiPrefs      String?");
  });
  test("the five nav events exist", () => {
    for (const e of ["nav_switcher_opened", "nav_intro_shown", "nav_intro_try", "nav_intro_later", "nav_style_changed"]) expect(trackSrc).toContain(`"${e}"`);
  });
  test("navFor returns intro", () => {
    expect(navStyle).toContain("intro: boolean");
    expect(navStyle).toContain("intro: !!user && introEligible(");
  });
  test("provider is the single source of truth", () => {
    for (const s of ["export function NavStyleProvider", "export function useNavStyle", "export function NavFrame", 'track("nav_style_changed"', 'const CHANNEL = "outlly:nav"', "new BroadcastChannel(CHANNEL)"]) expect(provider).toContain(s);
  });
});
