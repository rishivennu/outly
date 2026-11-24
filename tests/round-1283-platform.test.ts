/**
 * R1283: the platform side of edge to edge. An installed app hears about a newer build when it comes back (never a
 * reload by itself), the first HTML carries the theme's color-scheme, and the admin Home Screen app takes the same
 * status bar style as the studio.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("R1283 /api/build", () => {
  test("answers the running build, never cached", async () => {
    const { GET, dynamic } = await import("@/app/api/build/route");
    expect(dynamic).toBe("force-dynamic");
    const res = GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ build: process.env.NEXT_PUBLIC_BUILD || "dev" });
  });
  test("next.config inlines the build id from the commit", () => {
    expect(src("next.config.mjs")).toContain('env: { NEXT_PUBLIC_BUILD: process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || process.env.NEXT_PUBLIC_BUILD || "dev" },'); // R1312: Render's commit too
  });
  test("the service worker never answers /api, so the check always reaches the server", () => {
    expect(src("public/sw.js")).toContain('if (p.startsWith("/api/")) return null;');
  });
});

describe("R1283 fresh on resume", () => {
  test("only an installed app asks", async () => {
    const { isInstalled } = await import("@/lib/client/fresh-on-resume");
    const mm = (on: boolean) => () => ({ matches: on });
    const html = (app: boolean) => ({ documentElement: { hasAttribute: (n: string) => app && n === "data-app" } });
    expect(isInstalled({ matchMedia: mm(true) })).toBe(true);
    expect(isInstalled({ matchMedia: mm(false), navigator: { standalone: true } })).toBe(true);
    expect(isInstalled({ matchMedia: mm(false), navigator: {}, document: html(true) })).toBe(true);
    expect(isInstalled({ matchMedia: mm(false), navigator: {}, document: html(false) })).toBe(false);
    expect(isInstalled({ matchMedia: () => { throw new Error("old browser"); }, navigator: {} })).toBe(false);
  });
  test("ten minutes away at least", async () => {
    const { shouldCheck, RESUME_AFTER_MS } = await import("@/lib/client/fresh-on-resume");
    expect(RESUME_AFTER_MS).toBe(600_000);
    expect(shouldCheck(null, 10 ** 12)).toBe(false);
    expect(shouldCheck(1_000, 1_000 + 599_999)).toBe(false);
    expect(shouldCheck(1_000, 1_000 + 600_000)).toBe(true);
  });
  test("a real, different build only; dev never counts", async () => {
    const { isNewBuild } = await import("@/lib/client/fresh-on-resume");
    expect(isNewBuild("abc", "def")).toBe(true);
    expect(isNewBuild("abc", "abc")).toBe(false);
    expect(isNewBuild("dev", "def")).toBe(false);
    expect(isNewBuild("abc", "dev")).toBe(false);
    expect(isNewBuild("abc", "")).toBe(false);
    expect(isNewBuild("abc", undefined)).toBe(false);
    expect(isNewBuild("abc", 42)).toBe(false);
  });
  test("copy: plain words, no em dash", async () => {
    const { UPDATE_TEXT, UPDATE_ACTION } = await import("@/lib/client/fresh-on-resume");
    expect([UPDATE_TEXT, UPDATE_ACTION]).toEqual(["Outlly has an update.", "Reload"]);
    for (const s of [UPDATE_TEXT, UPDATE_ACTION, src("components/pwa/FreshOnResume.tsx")]) expect(s).not.toContain("\u2014");
  });
  test("the component: standalone guard first, reload only from the toast button, one toast per build per session", () => {
    const c = src("components/pwa/FreshOnResume.tsx");
    expect(c.startsWith('"use client";')).toBe(true);
    const body = c.slice(c.indexOf("useEffect(() => {"));
    expect(body.indexOf("if (!isInstalled(window)) return;")).toBeGreaterThan(0);
    expect(body.indexOf("if (!isInstalled(window)) return;")).toBeLessThan(body.indexOf("addEventListener"));
    expect(c.match(/location\.reload\(\)/g)?.length).toBe(1);
    expect(c).toContain("action: { label: UPDATE_ACTION, onClick: () => location.reload() }");
    expect(c).toContain('fetch(BUILD_URL, { cache: "no-store" })');
    expect(c).toContain("sessionStorage.getItem(SEEN_KEY) === live");
    expect(c).toContain("if (req.shown) sessionStorage.setItem(SEEN_KEY, live);");
    expect(c).toContain('document.addEventListener("visibilitychange", onVisibility);');
    expect(c).toContain("if (e.persisted) void check();");
    expect(c).not.toMatch(/location\.(href|replace|assign)/);
  });
  test("mounted once, from the root client, after the page has settled", () => {
    const r = src("components/shared/RootClient.tsx");
    expect(r.match(/<FreshOnResume \/>/g)?.length).toBe(1);
    expect(r).toContain('import("@/components/pwa/FreshOnResume")');
    expect(r.indexOf("<FreshOnResume />")).toBeGreaterThan(r.indexOf("{settled && ("));
  });
  test("the toast hosts pick the request up from the window", () => {
    const t = src("components/shared/Toast.tsx");
    expect(t).toContain("window.addEventListener(TOAST_EVENT, on);");
    expect(t).toContain("if (!d || d.shown) return;");
  });
});

describe("R1283 first HTML", () => {
  test("color-scheme follows the saved theme, dark by default", async () => {
    const { colorSchemeFor } = await import("@/lib/theme/colors");
    expect([colorSchemeFor(undefined), colorSchemeFor("dark"), colorSchemeFor("light"), colorSchemeFor("system")]).toEqual(["dark", "dark", "light", "light dark"]);
    expect(src("app/layout.tsx")).toContain("colorScheme: colorSchemeFor((await cookies()).get(THEME_COOKIE)?.value) };");
    const css = src("app/globals.css");
    expect(css).toMatch(/html \{\n\s+color-scheme: light;/);
    expect(css).toMatch(/html\.dark \{\n\s+color-scheme: dark;/);
  });
  test("the admin Home Screen app takes the studio's status bar style per theme", async () => {
    const { adminAppMeta } = await import("@/lib/admin/app-meta");
    expect(adminAppMeta(undefined).appleWebApp.statusBarStyle).toBe("black-translucent");
    expect(adminAppMeta("dark").appleWebApp.statusBarStyle).toBe("black-translucent");
    expect(adminAppMeta("light").appleWebApp.statusBarStyle).toBe("default");
    for (const f of ["app/admin/login/page.tsx", "app/admin/(panel)/layout.tsx"]) {
      expect(src(f)).toContain("export async function generateMetadata(): Promise<Metadata> {");
      expect(src(f)).not.toContain("export const metadata");
    }
  });
  test("under the translucent bar the admin desktop sidebar and header clear the inset (iPad)", () => {
    const s = src("components/admin/AdminShell.tsx");
    expect(s).toContain("hidden h-dvh shrink-0 p-3 pt-[max(0.75rem,var(--sa-t))] lg:block");
    expect(s).toContain("lg:pt-[max(1.25rem,var(--sa-t))]");
  });
  test("both manifests keep the dark theme colours", () => {
    expect(src("app/admin.webmanifest/route.ts")).toContain("background_color: THEME_COLOR.dark,\n    theme_color: THEME_COLOR.dark,");
  });
  test("the edge-to-edge doc exists and the README links it", () => {
    const d = src("docs/edge-to-edge.md");
    for (const h of ["## Architecture", "## Per-platform matrix", "## Known OS limits", "## Capacitor wrapper checklist", "## Real-device test script"]) expect(d).toContain(h);
    expect(src("README.md")).toContain("docs/edge-to-edge.md");
  });
});
