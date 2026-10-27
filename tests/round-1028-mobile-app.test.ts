import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { APP_FLAG, APP_PACKAGE, APP_SELLS_PLANS, appNavKind, appScript, appTitle } from "../lib/app-mode";

function runScript({ search = "", referrer = "", stored = null as string | null } = {}) {
  const attrs: Record<string, string> = {};
  const store = new Map<string, string>(stored ? [[APP_FLAG, stored]] : []);
  const document = { referrer, documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
  const sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
  new Function("document", "sessionStorage", "location", appScript)(document, sessionStorage, { search });
  return { app: attrs["data-app"], stored: store.get(APP_FLAG) };
}

describe("app mode detection (head script)", () => {
  test("the app's launch URL turns app mode on and remembers it for the tab", () => {
    expect(runScript({ search: "?source=twa" })).toEqual({ app: "android", stored: "1" });
    expect(runScript({ search: "?x=1&source=twa&y=2" }).app).toBe("android");
  });
  test("the Android app referrer turns it on (shortcuts and the share sheet open without ?source)", () => {
    expect(runScript({ referrer: `android-app://${APP_PACKAGE}/` }).app).toBe("android");
  });
  test("a later navigation in the same app tab stays in app mode", () => {
    expect(runScript({ stored: "1" }).app).toBe("android");
  });
  test("the website never switches on", () => {
    expect(runScript({ search: "?source=pwa" }).app).toBeUndefined();
    expect(runScript({ search: "?source=twa-ad" }).app).toBeUndefined();
    expect(runScript({ referrer: "android-app://com.other.app/" }).app).toBeUndefined();
    expect(runScript({ referrer: "https://www.google.com/" }).app).toBeUndefined();
  });
  test("a storage error (blocked storage) never breaks the page", () => {
    const boom = { getItem: () => { throw new Error("denied"); }, setItem: () => {} };
    expect(() => new Function("document", "sessionStorage", "location", appScript)({ referrer: "", documentElement: {} }, boom, { search: "" })).not.toThrow();
  });
});

describe("appNavKind (iOS screen transitions)", () => {
  test("first screen does not animate", () => expect(appNavKind(null, "/home", false)).toBe("none"));
  test("switching tabs cross-fades", () => {
    expect(appNavKind("/home", "/inbox", false)).toBe("fade");
    expect(appNavKind("/inbox", "/analytics", false)).toBe("fade");
  });
  test("Create rises as a sheet, and closing it fades back to the tab", () => {
    expect(appNavKind("/home", "/create", false)).toBe("sheet");
    expect(appNavKind("/create", "/home", false)).toBe("fade");
  });
  test("going deeper pushes, Back pops", () => {
    expect(appNavKind("/analytics", "/analytics/instagram", false)).toBe("push");
    expect(appNavKind("/home", "/settings", false)).toBe("push");
    expect(appNavKind("/analytics/instagram", "/analytics", true)).toBe("pop");
  });
  test("Back into Create is still a pop, not a new sheet", () => expect(appNavKind("/create/bulk", "/create", true)).toBe("pop"));
});

describe("appTitle", () => {
  test("tab screens get a large title and no Back", () => {
    expect(appTitle("/inbox")).toEqual({ title: "Inbox", parent: null });
    expect(appTitle("/home")).toEqual({ title: "Home", parent: null });
  });
  test("deeper screens name their parent for the Back button", () => {
    expect(appTitle("/analytics/youtube")).toEqual({ title: "YouTube", parent: { href: "/analytics", label: "Analytics" } });
    expect(appTitle("/create/bulk").parent).toEqual({ href: "/create", label: "New post" });
  });
});

describe("Play Store readiness", () => {
  test("the app never sells plans (Google Play billing policy)", () => expect(APP_SELLS_PLANS).toBe(false));
  test("app CSS hides every billing and pricing link, and only inside the app", () => {
    const css = readFileSync("app/mobile-app.css", "utf8");
    for (const sel of ['html[data-app] a[href^="/billing"]', 'html[data-app] a[href^="/pricing"]']) expect(css).toContain(sel);
    expect(css).toContain("html:not([data-app]) .app-only { display: none !important; }");
  });
  test("assetlinks.json verifies the app for this domain", () => {
    const links = JSON.parse(readFileSync("public/.well-known/assetlinks.json", "utf8"));
    expect(links[0].relation).toContain("delegate_permission/common.handle_all_urls");
    expect(links[0].target.package_name).toBe(APP_PACKAGE);
    for (const f of links[0].target.sha256_cert_fingerprints) expect(f).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
  test("middleware never redirects /.well-known (maintenance or waitlist would break app verification)", () => {
    const src = readFileSync("middleware.ts", "utf8");
    const m = src.match(/matcher:\s*\["([^"]+)"\]/)![1].replace(/\\\\/g, "\\");
    const re = new RegExp(`^${m}$`);
    expect(re.test("/.well-known/assetlinks.json")).toBe(false);
    expect(re.test("/home")).toBe(true);
    expect(re.test("/create")).toBe(true);
  });
});

describe("sign-in redirects keep the app flag", () => {
  test("?source=twa survives the trip to /login", async () => {
    const { NextRequest } = await import("next/server");
    const { keepAppSource } = await import("../middleware");
    const app = keepAppSource(new NextRequest("https://outly-ecru.vercel.app/home?source=twa"), new URL("https://outly-ecru.vercel.app/login?next=%2Fhome"));
    expect(app.searchParams.get("source")).toBe("twa");
    const web = keepAppSource(new NextRequest("https://outly-ecru.vercel.app/home"), new URL("https://outly-ecru.vercel.app/login"));
    expect(web.searchParams.has("source")).toBe(false);
  });
});
