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
});
