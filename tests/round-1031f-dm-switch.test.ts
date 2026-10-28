// 1031f: an admin switch that drops the messaging permissions from the Instagram and Facebook logins, so the
// app can go live with publishing and comments while Meta is still reviewing messaging.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

let ig: typeof import("../lib/social/instagram");
let fb: typeof import("../lib/social/facebook");
let keys: typeof import("../lib/social/keys");
let svc: typeof import("../lib/messages/service");
const realFetch = globalThis.fetch;
const src = (p: string) => readFileSync(p, "utf8");
const scopeOf = (url: string) => (new URL(url).searchParams.get("scope") ?? "").split(",");
const set = (dms?: boolean) =>
  keys.__setKeys({
    instagram: { clientId: "ig-1", clientSecret: "s", ...(dms === undefined ? {} : { dms }) },
    facebook: { clientId: "fb-1", clientSecret: "s", ...(dms === undefined ? {} : { dms }) },
  } as never);

beforeAll(async () => {
  ig = await import("../lib/social/instagram");
  fb = await import("../lib/social/facebook");
  keys = await import("../lib/social/keys");
  svc = await import("../lib/messages/service");
});
afterAll(() => {
  globalThis.fetch = realFetch;
  keys.__setKeys(undefined);
});

describe("DM switch", () => {
  test("unset means on: nothing changes for apps that never touched the switch", async () => {
    set();
    expect(keys.dmsOn("instagram")).toBe(true);
    expect(scopeOf((await new ig.InstagramPublisher().connect("https://x.test/cb")).url)).toContain("instagram_business_manage_messages");
    expect(scopeOf((await new fb.FacebookPublisher().connect("https://x.test/cb")).url)).toEqual(expect.arrayContaining(["pages_messaging", "pages_manage_metadata"]));
    expect(svc.dmsOffList()).toEqual([]);
  });

  test("off: Instagram asks only for basic, publish and comments", async () => {
    set(false);
    const s = scopeOf((await new ig.InstagramPublisher().connect("https://x.test/cb")).url);
    expect(s).toEqual(["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments"]);
  });

  test("off: Facebook keeps publishing and insights but drops the Messenger pair", async () => {
    set(false);
    const s = scopeOf((await new fb.FacebookPublisher().connect("https://x.test/cb")).url);
    expect(s).toContain("pages_manage_posts");
    expect(s).toContain("read_insights");
    expect(s).not.toContain("pages_messaging");
    expect(s).not.toContain("pages_manage_metadata");
  });

  test("off: no 'messages were left unticked' notice, because we never asked", async () => {
    set(false);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.instagram.com/oauth/access_token")) return ok({ data: [{ access_token: "S", user_id: "1", permissions: "instagram_business_basic" }] });
      if (url.startsWith("https://graph.instagram.com/access_token")) return ok({ access_token: "L", expires_in: 5183944 });
      if (url.includes("/me?")) return ok({ user_id: "1", username: "u" });
      return new Response("nope", { status: 500 });
    }) as typeof fetch;
    expect((await new ig.InstagramPublisher().completeConnect("code", "https://x.test/cb")).declined).toEqual([]);
    set(true);
    expect((await new ig.InstagramPublisher().completeConnect("code", "https://x.test/cb")).declined).toEqual(["instagram_business_manage_messages"]);
  });

  test("the inbox is told which platforms are off", () => {
    keys.__setKeys({ instagram: { clientId: "i", clientSecret: "s", dms: false }, facebook: { clientId: "f", clientSecret: "s" } } as never);
    expect(svc.dmsOffList()).toEqual(["instagram"]);
    expect(src("app/api/messages/route.ts")).toContain("dmsOff: dmsOffList()");
    expect(src("app/(studio)/inbox/page.tsx")).toContain("dmsOff: dmsOffList()");
  });

  test("webhook subscribe and DM sync are skipped when off", () => {
    expect(src("lib/accounts.ts")).toContain("if (!dmsOn(platform)) return;");
    expect(src("lib/messages/service.ts")).toContain("!dmsOn(a.platform)) continue;");
  });

  test("admin API accepts the flag for Instagram and Facebook only; the card has a labelled switch", () => {
    const r = src("app/api/admin/platforms/route.ts");
    expect(r).toContain("dms: z.boolean().optional()");
    expect(r).toContain('b.platform === "instagram" || b.platform === "facebook"');
    const f = src("components/admin/PlatformKeysForm.tsx");
    expect(f).toContain('role="switch"');
    expect(f).toContain("Ask for the messaging permission");
    expect(f).toContain("aria-describedby={`${p}-dms-hint`}");
  });
});

describe("DM switch off also pauses replies (1031g review)", () => {
  test("replying to an existing live thread gives the friendly 'switched off' error and never calls Meta", async () => {
    const { db } = await import("../lib/db");
    const { encrypt } = await import("../lib/crypto");
    const u = await db.user.create({ data: { name: "DM off", email: `dmoff-${Date.now()}@test.dev`, passwordHash: "x" } });
    const a = await db.socialAccount.create({ data: { userId: u.id, platform: "instagram", platformUserId: `real-dmoff-${Date.now()}`, username: "@live", accessToken: encrypt("tok"), status: "connected" } });
    const t = await db.dmThread.create({ data: { userId: u.id, accountId: a.id, platform: "instagram", participantId: "igsid-1", lastMessageAt: new Date(), lastInboundAt: new Date() } });
    let called = 0;
    globalThis.fetch = (async () => {
      called++;
      return new Response("{}", { status: 200 });
    }) as never;
    set(false);
    const err = await svc.replyToThread(u.id, u.id, t.id, "hello").then(() => null, (e) => e);
    expect(err?.code).toBe("DMS_OFF");
    expect(err?.message).toContain("switched off");
    expect(called).toBe(0);
    set();
  });
  test("the admin note says connected creators are paused too", () => {
    expect(src("components/admin/PlatformKeysForm.tsx")).toContain("pauses syncing and sending direct messages");
  });
});
