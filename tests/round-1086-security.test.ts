/**
 * Security audit 1086 regression tests.
 * - Held connects: an app start link can't attach someone else's social account to the link's owner.
 * - Hand-off sessions: short-lived, never remembered, refused by the plain web connect.
 * - App codes work once.
 * - 2FA lockout is counted in the database, so it holds across server instances.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { decodeJwt } from "jose";

// cookies() only works inside a Next request; give the code under test a cookie jar instead.
const jar = new Map<string, { value: string; opts: Record<string, unknown> }>();
const cookieApi = {
  get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (n: string) => jar.has(n),
  set: (n: string | { name: string; value: string }, v?: string, o?: Record<string, unknown>) => {
    if (typeof n === "object") {
      const { name, value, ...rest } = n as { name: string; value: string };
      jar.set(name, { value, opts: rest });
    } else jar.set(n, { value: v ?? "", opts: o ?? {} });
  },
  delete: (n: string | { name: string }) => jar.delete(typeof n === "object" ? n.name : n),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

const { db } = await import("../lib/db");
const { SESSION_COOKIE, createSession, isHandoffSession, readSessionUserId } = await import("../lib/auth");
const handoff = await import("../lib/app-handoff");
const { APP_CH_COOKIE, challengeOf, holdConnect, redeemCode, signCode, signStart, takeHeld } = handoff;
const { saveOAuthState } = await import("../lib/oauth-state");
const { guard, wrong } = await import("../lib/otp/two-factor");
const { GET: startGET } = await import("../app/api/app/start/route");
const { GET: returnGET } = await import("../app/api/app/return/route");
const { POST: finishPOST } = await import("../app/api/app/finish/route");
const { GET: callbackGET } = await import("../app/api/accounts/[platform]/callback/route");

const VERIFIER = "a".repeat(20) + "-._~" + "B2".repeat(12);
const CH = challengeOf(VERIFIER);
const OTHER_VERIFIER = "c".repeat(48);
const users: string[] = [];
const mkUser = async (tag: string) => {
  const u = await db.user.create({ data: { name: `Sec ${tag}`, email: `sec1086-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`, passwordHash: "x" } });
  users.push(u.id);
  return u;
};
const prof = (id = "mock-ig-1") => ({ platformUserId: id, username: "victim_ig", accessToken: "tok-secret", expiresAt: new Date(Date.now() + 86_400_000) });
const finish = (code: string, verifier = VERIFIER) =>
  finishPOST(
    new NextRequest("http://localhost/api/app/finish", { method: "POST", body: JSON.stringify({ code, verifier }), headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" } }),
    { params: {} } as never,
  );

beforeEach(() => jar.clear());
afterAll(async () => {
  jar.clear();
  await db.setting.deleteMany({ where: { key: { startsWith: "app-hold:" } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
});

describe("hand-off session (app start link)", () => {
  test("is marked, lives 15 minutes and is never a remembered cookie", async () => {
    const u = await mkUser("ho");
    const t = await signStart({ uid: u.id, to: "/api/accounts/instagram/connect", ch: CH });
    const res = await startGET(new NextRequest(`http://localhost/api/app/start?t=${encodeURIComponent(t)}`));
    expect(res.status).toBe(307);
    const c = jar.get(SESSION_COOKIE)!;
    expect(c).toBeDefined();
    expect(c.opts.maxAge).toBeUndefined();
    const claims = decodeJwt(c.value);
    expect(claims.ho).toBe(1);
    expect(claims.rm).toBe(0);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(15 * 60);
    expect(await isHandoffSession()).toBe(true);
    expect(await readSessionUserId()).toBe(u.id);
  });
  test("a normal sign-in is not a hand-off session", async () => {
    const u = await mkUser("normal");
    await createSession(u.id);
    expect(await isHandoffSession()).toBe(false);
    expect(jar.get(SESSION_COOKIE)!.opts.maxAge).toBe(60 * 60 * 24 * 14);
  });
  test("can't connect an account through the plain web flow", async () => {
    const u = await mkUser("webconnect");
    await createSession(u.id, { handoff: true });
    await saveOAuthState("instagram", { state: "s-1086", returnTo: "/accounts" });
    const res = await callbackGET(new NextRequest("http://localhost/api/accounts/instagram/callback?state=s-1086&code=abc"), { params: { platform: "instagram" } });
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/accounts");
    expect(loc.searchParams.get("connect_error")).toBe("instagram");
    expect(loc.searchParams.get("reason")).toBe("state");
    expect(await db.socialAccount.count({ where: { userId: u.id } })).toBe(0);
  });
  test("can't connect through the app flow without the app's challenge cookie", async () => {
    const u = await mkUser("nocookie");
    await createSession(u.id, { handoff: true });
    await saveOAuthState("instagram", { state: "s-1086b", returnTo: "/api/app/return?next=%2Faccounts" });
    const res = await callbackGET(new NextRequest("http://localhost/api/accounts/instagram/callback?state=s-1086b&code=abc"), { params: { platform: "instagram" } });
    expect(new URL(res.headers.get("location")!).searchParams.get("reason")).toBe("state");
  });
});

describe("held connects", () => {
  test("only the same user and challenge can take a held connect, once", async () => {
    const u = await mkUser("hold");
    const other = await mkUser("hold-other");
    const id = await holdConnect({ uid: u.id, ch: CH, platform: "instagram", prof: prof() });
    expect(await takeHeld(id, other.id, CH)).toBeNull(); // wrong user: and the hold is spent
    const id2 = await holdConnect({ uid: u.id, ch: CH, platform: "instagram", prof: prof() });
    expect(await takeHeld(id2, u.id, challengeOf(OTHER_VERIFIER))).toBeNull();
    const id3 = await holdConnect({ uid: u.id, ch: CH, platform: "instagram", prof: prof() });
    const h = await takeHeld(id3, u.id, CH);
    expect(h?.platform).toBe("instagram");
    expect(h?.prof.expiresAt instanceof Date).toBe(true);
    expect(await takeHeld(id3, u.id, CH)).toBeNull();
  });
  test("a held connect is stored encrypted", async () => {
    const u = await mkUser("enc");
    const id = await holdConnect({ uid: u.id, ch: CH, platform: "instagram", prof: prof() });
    const row = await db.setting.findUnique({ where: { key: `app-hold:${id}` } });
    expect(row!.value).not.toContain("tok-secret");
    expect(row!.value).not.toContain(u.id);
  });
  test("a stale held connect can't be taken", async () => {
    const u = await mkUser("stale");
    const id = await holdConnect({ uid: u.id, ch: CH, platform: "instagram", prof: prof() });
    await db.$executeRawUnsafe(`UPDATE "Setting" SET "updatedAt" = ? WHERE "key" = ?`, new Date(Date.now() - 16 * 60_000).getTime(), `app-hold:${id}`);
    expect(await takeHeld(id, u.id, CH)).toBeNull();
  });
  test("the return page puts the hold in the code, not in the page the app opens", async () => {
    const hold = "0b5e2c1a-1234-4abc-8def-0123456789ab";
    const res = await returnGET(
      new NextRequest(`http://localhost/api/app/return?next=%2Faccounts&connected=instagram&hold=${hold}`, { headers: { cookie: `${APP_CH_COOKIE}=${CH}` } }),
    );
    const html = await res.text();
    const code = decodeURIComponent(/code=([^"]+)"/.exec(html)![1]);
    const claims = decodeJwt(code);
    expect(claims.hold).toBe(hold);
    expect(String(claims.next)).toBe("/accounts?connected=instagram");
  });
  test("the app that started the flow finishes it and the account is saved, once", async () => {
    const u = await mkUser("finish");
    const hold = await holdConnect({ uid: u.id, ch: CH, platform: "instagram", prof: prof("mock-ig-finish") });
    const code = await signCode({ uid: u.id, ch: CH, next: "/accounts?connected=instagram", hold });
    const res = await finish(code);
    expect(res.status).toBe(200);
    expect((await res.json()).next).toBe("/accounts?connected=instagram");
    const accts = await db.socialAccount.findMany({ where: { userId: u.id, platform: "instagram" } });
    expect(accts.length).toBe(1);
    expect(accts[0].accessToken).not.toBe("tok-secret");
    expect((await finish(code)).status).toBe(400); // the same code again
  });
  test("the attack: a victim's own app can't redeem a code made for the link owner's challenge", async () => {
    const attacker = await mkUser("attacker");
    const hold = await holdConnect({ uid: attacker.id, ch: CH, platform: "instagram", prof: prof("mock-ig-victim") });
    const code = await signCode({ uid: attacker.id, ch: CH, next: "/accounts?connected=instagram", hold });
    expect((await finish(code, OTHER_VERIFIER)).status).toBe(400);
    expect(await db.socialAccount.count({ where: { userId: attacker.id } })).toBe(0);
  });
  test("a missing hold tells the app to start again instead of claiming success", async () => {
    const u = await mkUser("gone");
    const code = await signCode({ uid: u.id, ch: CH, next: "/accounts?connected=instagram&notice=dm_scope", hold: "11111111-2222-4333-8444-555555555555" });
    const res = await finish(code);
    expect(res.status).toBe(200);
    const next = new URL((await res.json()).next, "http://x");
    expect(next.searchParams.get("connected")).toBeNull();
    expect(next.searchParams.get("connect_error")).toBe("instagram");
    expect(next.searchParams.get("reason")).toBe("state");
    expect(await db.socialAccount.count({ where: { userId: u.id } })).toBe(0);
  });
});

describe("app codes", () => {
  test("a signed-in code redeems once", async () => {
    const u = await mkUser("once");
    const code = await signCode({ uid: u.id, ch: CH, next: "/home" });
    expect((await redeemCode(code, VERIFIER))?.uid).toBe(u.id);
    expect(await redeemCode(code, VERIFIER)).toBeNull();
  });
  test("a code without an id (made before 1086) is refused", async () => {
    const { SignJWT } = await import("jose");
    const old = await new SignJWT({ ch: CH, next: "/home", sub: "u1" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("outlly-app-code")
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(`${process.env.AUTH_SECRET}:app-handoff`));
    expect(await redeemCode(old, VERIFIER)).toBeNull();
  });
});

describe("2FA lockout across instances", () => {
  test("wrong codes recorded by other instances lock this one too", async () => {
    const u = await mkUser("2fa");
    await guard(u.id);
    for (let i = 0; i < 6; i++) await db.featureUse.create({ data: { userId: u.id, feature: "2fa-fail", period: "window", ref: `other-${i}` } });
    await expect(guard(u.id)).rejects.toMatchObject({ code: "2FA_LOCKED" });
  });
  test("failures older than the window don't count, and a wrong code is recorded", async () => {
    const u = await mkUser("2fa-old");
    const old = new Date(Date.now() - 16 * 60_000);
    for (let i = 0; i < 6; i++) await db.featureUse.create({ data: { userId: u.id, feature: "2fa-fail", period: "window", ref: `old-${i}`, createdAt: old } });
    await guard(u.id);
    const e = await wrong(u.id, "nope");
    expect(e.code).toBe("2FA_WRONG");
    expect(await db.featureUse.count({ where: { userId: u.id, feature: "2fa-fail" } })).toBe(1); // old ones swept
  });
});
