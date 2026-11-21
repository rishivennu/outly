/** R1291: the navigation pick lives on the account (User.uiPrefs) and follows the person; the cookie is only a mirror. */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_INTRO_VERSION, introEligible, parseUiPrefs, resolveNav } from "../lib/nav-config";

let db: typeof import("../lib/db").db;
let prefs: typeof import("../lib/ui-prefs");
const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const tag = `r1291p${Date.now().toString(36)}`;
let n = 0;

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  prefs = await import("../lib/ui-prefs");
});

const mkUser = async () => {
  n += 1;
  const email = `${tag}-u${n}@test.dev`;
  return db.user.create({ data: { name: `Creator ${n}`, email, passwordHash: "x" } });
};

describe("R1291 uiPrefs on the account", () => {
  test("a fresh account has empty prefs; a pick is saved and read back", async () => {
    const u = await mkUser();
    expect(await prefs.readUiPrefs(u.id)).toEqual({ v: 1 });
    const saved = await prefs.patchUiPrefs(u.id, (p) => ({ ...p, nav: "dock", navTried: true }));
    expect(saved).toEqual({ v: 1, nav: "dock", navTried: true });
    const row = await db.user.findUnique({ where: { id: u.id }, select: { uiPrefs: true } });
    expect(parseUiPrefs(row?.uiPrefs)).toEqual({ v: 1, nav: "dock", navTried: true });
  });
  test("forgetting the pick keeps the rest (tried, intro)", async () => {
    const u = await mkUser();
    await prefs.patchUiPrefs(u.id, (p) => ({ ...p, nav: "dock", navTried: true, navIntro: { v: NAV_INTRO_VERSION, state: "tried", at: "2026-11-21T00:00:00.000Z" } }));
    const after = await prefs.patchUiPrefs(u.id, ({ nav: _n, ...rest }) => rest);
    expect(after.nav).toBeUndefined();
    expect(after.navTried).toBe(true);
    expect(after.navIntro?.state).toBe("tried");
  });
  test("the saved pick decides the layout on a device with no cookie, and over a stale cookie", async () => {
    const u = await mkUser();
    const p = await prefs.patchUiPrefs(u.id, (x) => ({ ...x, nav: "dock" }));
    const cfg = { style: "sidebar" as const, userSwitch: true };
    expect(resolveNav(cfg, undefined, p.nav)).toBe("dock");
    expect(resolveNav(cfg, "sidebar", p.nav)).toBe("dock");
    expect(resolveNav({ ...cfg, userSwitch: false }, "dock", p.nav)).toBe("sidebar");
  });
  test("someone who tried the dock never meets the card again, even back on the sidebar", async () => {
    const u = await mkUser();
    const p = await prefs.patchUiPrefs(u.id, (x) => ({ ...x, nav: "sidebar", navTried: true }));
    expect(introEligible({ style: "sidebar", canSwitch: true, prefs: p })).toBe(false);
    const fresh = await prefs.readUiPrefs((await mkUser()).id);
    expect(introEligible({ style: "sidebar", canSwitch: true, prefs: fresh })).toBe(true);
  });
  test("a corrupt column reads as defaults instead of throwing", async () => {
    const u = await mkUser();
    await db.user.update({ where: { id: u.id }, data: { uiPrefs: "{not json" } });
    expect(await prefs.readUiPrefs(u.id)).toEqual({ v: 1 });
  });
});

describe("R1291 plumbing pins", () => {
  test("the session user carries uiPrefs on the same read; a teammate keeps their own", () => {
    const auth = read("lib/auth.ts");
    expect(auth).toMatch(/const USER_SELECT = \{[^}]*uiPrefs: true \} as const;/);
    expect(auth).toContain("{ ...seat.owner, uiPrefs: me.uiPrefs,");
  });
  test("navFor reads the cached user, saved pick first, and reports intro", () => {
    const s = read("lib/nav-style.ts");
    expect(s).toContain("getCurrentUser()");
    expect(s).toContain("resolveNav(cfg, cookie, prefs.nav)");
    expect(s).toContain("introEligible({ style, canSwitch: cfg.userSwitch, prefs })");
    expect(s).toContain("intro: false }");
  });
  test("POST saves to the account (realUserId) and marks the dock tried; DELETE forgets nav only", () => {
    const r = read("app/api/me/nav/route.ts");
    expect(r).toContain("patchUiPrefs(realUserId(user), (p) => ({ ...p, nav: style, ...(style === \"dock\" ? { navTried: true } : {}) }))");
    expect(r).toContain("patchUiPrefs(realUserId(user), ({ nav: _n, ...rest }) => rest)");
    const i = read("app/api/me/nav/intro/route.ts");
    expect(i).toContain('z.enum(["dismissed", "tried"])');
    expect(i).toContain("navIntro: { v: NAV_INTRO_VERSION, state, at: new Date().toISOString() }");
  });
  test("both schemas carry the column; the live one is generated from the template", () => {
    expect(read("prisma/schema.template.prisma")).toContain("uiPrefs      String?");
    expect(read("prisma/schema.prisma")).toContain("uiPrefs      String?");
  });
  test("the frame pads for the dock from data-nav, so the switch needs no server render", () => {
    const css = read("app/globals.css");
    expect(css).toContain("[data-nav] .studio-dock > * { animation: nav-dock-in");
    expect(css).toContain("[data-nav] .mmain { transition: padding-bottom");
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\[data-nav\] \.studio-dock/);
    expect(read("components/shared/Toast.tsx")).toContain("[data-nav=dock]");
  });
});
