// R1199: Instagram insights permission. Off for creators until Meta approves it (asking for an unapproved
// permission blocks the login for the public); a signed-in super admin is still asked, for the review screencast.
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

type Jar = Map<string, { value: string; opts: Record<string, unknown> }>;
const g = globalThis as unknown as { __r1199Admin?: unknown; __r1199User?: unknown; __r1199Keys?: boolean; __testCookieJar?: Jar; __cfg?: Map<string, unknown> };

// Run-wide mocks (bun keeps them for every file): each one falls through to the pinned real function unless this
// file's flag is set, and afterAll clears the flags.
const realAdminAuth = await import("../lib/admin/auth");
const realGetAdmin = realAdminAuth.getAdmin;
mock.module("../lib/admin/auth", () => ({ ...realAdminAuth, getAdmin: async () => (g.__r1199Admin !== undefined ? g.__r1199Admin : realGetAdmin()) }));
const realAuth = await import("../lib/auth");
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__r1199User !== undefined ? g.__r1199User : realGetCurrentUser()) }));
const realRegistry = await import("../lib/social/registry");
const realLoadKeys = realRegistry.loadKeys;
// The connect route reloads the keys from the database; under the flag it keeps the snapshot this file set.
mock.module("../lib/social/registry", () => ({ ...realRegistry, loadKeys: async () => (g.__r1199Keys ? undefined : realLoadKeys()) }));
// cookies() only works inside a Next request: the same shared jar as the other files that mock next/headers.
const jar: Jar = (g.__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

let ig: typeof import("../lib/social/instagram");
let keys: typeof import("../lib/social/keys");
const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const scopeOf = (url: string) => (new URL(url).searchParams.get("scope") ?? "").split(",");
const INS = "instagram_business_manage_insights";
const set = (o: { dms?: boolean; insights?: boolean } = {}) => keys.__setKeys({ instagram: { clientId: "ig-1", clientSecret: "s", ...o } } as never);
const admin = (role: string) => ({ id: "adm-r1199", name: "R1199 admin", login: "r1199", role });

beforeAll(async () => {
  ig = await import("../lib/social/instagram");
  keys = await import("../lib/social/keys");
});
afterAll(() => {
  g.__r1199Admin = undefined;
  g.__r1199User = undefined;
  g.__r1199Keys = undefined;
  keys.__setKeys(undefined);
});

describe("R1199 Instagram insights scope", () => {
  test("unset means off: creators are not asked, so the public login keeps working", async () => {
    set();
    expect(keys.insightsOn()).toBe(false);
    const s = scopeOf((await new ig.InstagramPublisher().connect("https://x.test/cb")).url);
    expect(s).not.toContain(INS);
    expect(s).toEqual(expect.arrayContaining(["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments"]));
  });

  test("the admin switch on asks every creator", async () => {
    set({ insights: true });
    expect(keys.insightsOn()).toBe(true);
    expect(scopeOf((await new ig.InstagramPublisher().connect("https://x.test/cb")).url)).toContain(INS);
  });

  test("switch off but asked for (a super admin connecting): insights is requested once, nothing else changes", async () => {
    set({ insights: false });
    const s = scopeOf((await new ig.InstagramPublisher().connect("https://x.test/cb", { insights: true })).url);
    expect(s.filter((x) => x === INS)).toHaveLength(1);
    expect(s).toContain("instagram_business_manage_messages");
  });

  test("insights and the DM switch are independent", async () => {
    set({ dms: false, insights: true });
    const s = scopeOf((await new ig.InstagramPublisher().connect("https://x.test/cb")).url);
    expect(s).toContain(INS);
    expect(s).not.toContain("instagram_business_manage_messages");
    expect(ig.instagramScopes(false)).toBe("instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments");
    expect(ig.instagramScopes(true, true).split(",")).toEqual([
      "instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments", "instagram_business_manage_messages", INS,
    ]);
  });
});

describe("R1199 wiring", () => {
  const route = src("app/api/accounts/[platform]/connect/route.ts");
  const admin = src("app/api/admin/platforms/route.ts");
  const form = src("components/admin/PlatformKeysForm.tsx");

  test("only a signed-in super admin is asked while the switch is off, and only for Instagram", () => {
    expect(route).toContain('import { getAdmin } from "@/lib/admin/auth";');
    expect(route).toContain('const insights = params.platform === "instagram" && !insightsOn() && (await getAdmin())?.role === "super";');
    expect(route).toContain("...(insights ? { insights: true } : {})");
  });

  test("the admin route saves the switch for Instagram only and logs it", () => {
    expect(admin).toContain("insights: z.boolean().optional(),");
    expect(admin).toContain('const storeInsights = b.platform === "instagram" && b.insights !== undefined;');
    expect(admin).toContain('`, insights ${b.insights ? "on" : "off"}`');
  });

  test("the Instagram card has the switch, off by default, and the scopes line follows it", () => {
    expect(form).toContain("Ask creators for Instagram insights");
    expect(form).toContain("useState(saved.insights === true)");
    expect(form).toContain('aria-describedby="instagram-insights-hint"');
    expect(form).toContain("...(ig ? { insights } : {})");
    expect(form).toContain("`${baseScopes}, instagram_business_manage_insights`");
  });
});

describe("R1199 connect route: who is asked while the switch is off", () => {
  async function scopes(who: unknown, platform = "instagram") {
    g.__r1199Admin = who;
    g.__r1199User = { id: "u-r1199", role: "owner" };
    g.__r1199Keys = true;
    const { GET } = await import("../app/api/accounts/[platform]/connect/route");
    const res = await GET(new NextRequest(`http://localhost/api/accounts/${platform}/connect?intent=reconnect`), { params: Promise.resolve({ platform }) });
    expect(res.status).toBe(307);
    const to = res.headers.get("location") ?? "";
    expect(to).toStartWith("https://www.instagram.com/oauth/authorize");
    return scopeOf(to);
  }

  test("a creator with no admin session is not asked", async () => {
    set();
    const s = await scopes(null);
    expect(s).not.toContain(INS);
    expect(s).toContain("instagram_business_basic");
  });

  test("finance, support and marketing admins are not asked", async () => {
    set({ insights: false });
    for (const role of ["finance", "support", "marketing"]) expect(await scopes(admin(role))).not.toContain(INS);
  });

  test("a super admin is asked, exactly once", async () => {
    set({ insights: false });
    const s = await scopes(admin("super"));
    expect(s.filter((x) => x === INS)).toHaveLength(1);
  });

  test("switch on: every creator is asked, with or without an admin session", async () => {
    set({ insights: true });
    expect(await scopes(null)).toContain(INS);
    expect((await scopes(admin("super"))).filter((x) => x === INS)).toHaveLength(1);
  });
});

describe("R1199 admin save: Instagram only, and other saves keep it", () => {
  let db: typeof import("../lib/db").db;
  let readConfig: typeof import("../lib/settings").readConfig;
  let PUT: typeof import("../app/api/admin/platforms/route").PUT;
  let before: { value: string } | null = null;
  const start = new Date();
  const put = async (body: Record<string, unknown>) => {
    const res = await PUT(
      new NextRequest("http://localhost/api/admin/platforms", { method: "PUT", headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({}) } as never,
    );
    expect(res.status).toBe(200);
    return (await readConfig("platforms")) as Record<string, { insights?: boolean; clientId?: string }>;
  };

  beforeAll(async () => {
    g.__r1199Keys = false;
    g.__r1199Admin = admin("super");
    db = (await import("../lib/db")).db;
    readConfig = (await import("../lib/settings")).readConfig;
    PUT = (await import("../app/api/admin/platforms/route")).PUT;
    before = await db.setting.findUnique({ where: { key: "platforms" } });
  });
  afterAll(async () => {
    if (before) await db.setting.update({ where: { key: "platforms" }, data: { value: before.value } });
    else await db.setting.deleteMany({ where: { key: "platforms" } });
    g.__cfg?.delete("platforms");
    await db.adminEvent.deleteMany({ where: { href: "/admin/platforms", title: { contains: "R1199 admin" }, createdAt: { gte: start } } });
  });

  test("saving Instagram stores the switch", async () => {
    expect((await put({ platform: "instagram", clientId: "ig-r1199", clientSecret: "sec", insights: true })).instagram.insights).toBe(true);
  });

  test("a Facebook save never stores insights and leaves Instagram's alone", async () => {
    const c = await put({ platform: "facebook", clientId: "fb-r1199", insights: true });
    expect(c.facebook.insights).toBeUndefined();
    expect(c.instagram.insights).toBe(true);
  });

  test("an Instagram save without the field keeps it; false turns it off", async () => {
    expect((await put({ platform: "instagram", clientId: "ig-r1199" })).instagram.insights).toBe(true);
    expect((await put({ platform: "instagram", clientId: "ig-r1199", insights: false })).instagram.insights).toBe(false);
  });
});
