import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    return statSync(join(root, p)).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("1110 admin console in the iPhone Home Screen app", () => {
  test("the admin session cookie is Lax, so a Home Screen app sends it", () => {
    const a = src("lib/admin/auth.ts");
    expect(a).toContain('sameSite: "lax", path: "/", maxAge: TTL_S');
    expect(a).not.toContain('sameSite: "strict"');
  });
  test("CSRF still covered: admin writes check the origin, and no admin GET handler writes", () => {
    expect(src("lib/admin/route.ts")).toContain("assertSameOrigin(req);");
    for (const f of files("app/api/admin")) {
      const s = src(f);
      const i = s.search(/export (const|async function) GET/);
      if (i < 0) continue;
      const j = s.indexOf("\nexport ", i + 1);
      const get = s.slice(i, j < 0 ? undefined : j); // only the GET handler, up to the next export
      expect([f, /\.(update|create|delete|upsert)(Many)?\(|destroyAdminSession/.test(get)]).toEqual([f, false]);
    }
  });
  test("admin pages are their own Home Screen app: own manifest, id, start_url and scope", async () => {
    const { GET } = await import("@/app/admin.webmanifest/route");
    const res = GET();
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    const m = await res.json();
    expect([m.id, m.start_url, m.scope, m.display, m.short_name]).toEqual(["/admin", "/admin?source=pwa", "/admin", "standalone", "Admin"]);
    const { adminAppMeta, ADMIN_MANIFEST } = await import("@/lib/admin/app-meta");
    expect(ADMIN_MANIFEST).toBe("/admin.webmanifest");
    expect(adminAppMeta.appleWebApp.title).toBe("Outlly Admin");
    for (const f of ["app/admin/login/page.tsx", "app/admin/(panel)/layout.tsx"]) expect(src(f)).toContain("robots: { index: false, follow: false }, ...adminAppMeta };");
    // outside /admin/ so the middleware never sends a phone fetching it to sign in, and .webmanifest skips it entirely
    expect(src("middleware.ts")).toContain("webmanifest)$).*)");
  });
});
