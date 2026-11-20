/**
 * 1253: the Meta data-deletion callback also serves the Threads app's Delete / Uninstall callbacks. Threads
 * signs the request with the Threads app secret (its own app id and secret live on the Threads use case),
 * and names the Threads user id, which is the connected account's platformUserId. A Facebook-signed
 * request keeps working, and one signed with an unknown secret is refused.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

const TH_SECRET = "threads-app-secret-1253";
const FB_SECRET = "fb-app-secret-1253";

let db: typeof import("../lib/db").db;
let enc: (s: string) => string;

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const signed = (uid: string, secret: string) => {
  const payload = b64(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: uid, issued_at: 1 }));
  return `${b64(createHmac("sha256", secret).update(payload).digest())}.${payload}`;
};
const call = async (s: string) => {
  const { POST } = await import("../app/api/webhooks/meta/deletion/route");
  return POST(new NextRequest("http://localhost/api/webhooks/meta/deletion", { method: "POST", body: new URLSearchParams({ signed_request: s }), headers: { "content-type": "application/x-www-form-urlencoded" } }));
};

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  enc = (await import("../lib/crypto")).encrypt;
  const settings = await import("../lib/settings");
  await settings.saveConfig("platforms", { threads: { clientId: "th-id-1253", clientSecret: TH_SECRET }, facebook: { clientId: "fb-id-1253", clientSecret: FB_SECRET } });
}, 60_000);

describe("1253 Threads deletion callback", () => {
  test("a Threads-signed request removes the Threads account with that id and nothing else", async () => {
    const u = await db.user.create({ data: { name: "Th 1253", email: `th-1253-${Date.now()}@test.dev`, passwordHash: "x" } });
    const uid = `17841${Date.now()}`;
    const th = await db.socialAccount.create({ data: { userId: u.id, platform: "threads", platformUserId: uid, username: "@th1253", accessToken: enc("tok") } });
    // Same id on another platform must survive: Threads only speaks for Threads accounts.
    const other = await db.socialAccount.create({ data: { userId: u.id, platform: "tiktok", platformUserId: uid, username: "@tt1253", accessToken: enc("tok") } });
    const res = await call(signed(uid, TH_SECRET));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { url: string; confirmation_code: string };
    expect(j.url).toContain("/privacy#data-deletion");
    expect(j.confirmation_code).toMatch(/^del-/);
    expect(await db.socialAccount.count({ where: { id: th.id } })).toBe(0);
    expect(await db.socialAccount.count({ where: { id: other.id } })).toBe(1);
  });

  test("Facebook-signed requests still work; an unknown secret is refused", async () => {
    const u = await db.user.create({ data: { name: "Th 1253b", email: `th-1253b-${Date.now()}@test.dev`, passwordHash: "x" } });
    const uid = `1022${Date.now()}`;
    const fb = await db.socialAccount.create({ data: { userId: u.id, platform: "facebook", platformUserId: uid, username: "@fb1253", accessToken: enc("tok") } });
    expect((await call(signed(uid, "someone-else"))).status).toBe(400);
    expect(await db.socialAccount.count({ where: { id: fb.id } })).toBe(1);
    expect((await call(signed(uid, FB_SECRET))).status).toBe(200);
    expect(await db.socialAccount.count({ where: { id: fb.id } })).toBe(0);
  });
});
