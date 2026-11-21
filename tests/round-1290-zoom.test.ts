import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ADMIN_VIEWPORT, ZOOM_LOCK_CONTENT, zoomLockScript, zoomLocked } from "@/lib/zoom-lock";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// R1290: pinch zoom is off inside the app (Home Screen launch, Android app) and in the admin console. Web pages keep it (1192).
describe("zoom lock (1290)", () => {
  test("locks for installed launches and admin, never for a plain web page", () => {
    expect(zoomLocked({ installed: false, admin: false })).toBe(false);
    expect(zoomLocked({ installed: true, admin: false })).toBe(true);
    expect(zoomLocked({ installed: false, admin: true })).toBe(true);
    expect(ADMIN_VIEWPORT.maximumScale).toBe(1);
    expect(ADMIN_VIEWPORT.userScalable).toBe(false);
    expect(ZOOM_LOCK_CONTENT).toContain("user-scalable=no");
  });

  test("the head script marks <html> and rewrites the viewport only where it should", () => {
    const run = (o: { path: string; standalone?: boolean; app?: boolean }) => {
      const attrs: Record<string, string> = o.app ? { "data-app": "android" } : {};
      let content = "width=device-width, initial-scale=1, maximum-scale=5";
      const meta = { setAttribute: (_k: string, v: string) => void (content = v) };
      const d = { getAttribute: (k: string) => attrs[k] ?? null, setAttribute: (k: string, v: string) => void (attrs[k] = v) };
      const sandbox = {
        document: { documentElement: d, querySelector: () => meta, addEventListener: () => {} },
        window: { matchMedia: (q: string) => ({ matches: !!o.standalone && q.includes("standalone") }) },
        navigator: { standalone: undefined },
        location: { pathname: o.path },
      };
      new Function(...Object.keys(sandbox), zoomLockScript)(...Object.values(sandbox));
      return { locked: attrs["data-zoom"] === "lock", content };
    };
    expect(run({ path: "/home" })).toEqual({ locked: false, content: "width=device-width, initial-scale=1, maximum-scale=5" });
    expect(run({ path: "/" })).toMatchObject({ locked: false });
    expect(run({ path: "/administrator" })).toMatchObject({ locked: false });
    expect(run({ path: "/home", standalone: true })).toEqual({ locked: true, content: ZOOM_LOCK_CONTENT });
    expect(run({ path: "/home", app: true })).toMatchObject({ locked: true });
    expect(run({ path: "/admin" })).toMatchObject({ locked: true });
    expect(run({ path: "/admin/users" })).toEqual({ locked: true, content: ZOOM_LOCK_CONTENT });
  });

  test("wired: root head script after appScript, CSS turns off pinch, admin layouts export the viewport", () => {
    const root = read("app/layout.tsx");
    expect(root.indexOf("__html: appScript")).toBeLessThan(root.indexOf("__html: zoomLockScript"));
    expect(root).toContain("maximumScale: 5, userScalable: true"); // web pages keep zoom (1192)
    expect(read("app/globals.css")).toContain('html[data-zoom="lock"], html[data-zoom="lock"] body { touch-action: pan-x pan-y; }');
    for (const f of ["app/admin/(panel)/layout.tsx", "app/admin/login/page.tsx"]) expect(read(f)).toContain("export const viewport: Viewport = { ...ADMIN_VIEWPORT };");
  });
});
