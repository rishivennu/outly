import { afterAll, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { db } from "../lib/db";
import { appScript, isNativeUA } from "../lib/app-mode";
import { APP_RETURN_PATH, browserTarget, challengeOf, claimStart, readStart, redeemCode, returnTarget, signCode, signStart, validChallenge, validVerifier } from "../lib/app-handoff";
import { fcmMessage, isDeadToken, pushToUser, serviceAccount } from "../lib/push/fcm";
import { appBounce } from "../middleware";
import { GET as startGET } from "../app/api/app/start/route";
import { GET as returnGET } from "../app/api/app/return/route";
import { POST as finishPOST } from "../app/api/app/finish/route";

const VERIFIER = "v".repeat(20) + "-._~" + "A1".repeat(12);
const CH = challengeOf(VERIFIER);
const key = () => new TextEncoder().encode(`${process.env.AUTH_SECRET}:app-handoff`);
const users: string[] = [];
const mkUser = async (tag: string) => {
  const u = await db.user.create({ data: { name: `Cap ${tag}`, email: `cap-${tag}-${Date.now()}@test.dev`, passwordHash: "x" } });
  users.push(u.id);
  return u;
};
afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
});

function runScript(ua: string, search = "") {
  const attrs: Record<string, string> = {};
  const store = new Map<string, string>();
  const document = { referrer: "", documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
  const sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
  new Function("document", "sessionStorage", "location", "navigator", appScript)(document, sessionStorage, { search }, { userAgent: ua });
  return attrs;
}

describe("native app detection", () => {
  const capUA = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 OutllyApp/1.1.0";
  test("the Capacitor app's user agent turns on app mode and marks the native shell", () => {
    expect(runScript(capUA)).toEqual({ "data-shell": "native", "data-app": "android" });
    expect(isNativeUA(capUA)).toBe(true);
  });
  test("the TWA is app mode without the native shell", () => {
    expect(runScript("Mozilla/5.0 Chrome/130.0", "?source=twa")).toEqual({ "data-app": "android" });
  });
  test("an ordinary browser is neither", () => {
    expect(runScript("Mozilla/5.0 Chrome/130.0")).toEqual({});
    expect(isNativeUA("Mozilla/5.0 Chrome/130.0")).toBe(false);
    expect(isNativeUA(null)).toBe(false);
  });
});

describe("browserTarget (what the app may open in the browser)", () => {
  const back = (u: string | null, p: string) => new URL(u!, "http://x").searchParams.get(p);
  test("Google sign-in comes back through /api/app/return with the page it wanted", () => {
    const t = browserTarget("/api/auth/google?next=%2Fcalendar");
    expect(t?.startsWith("/api/auth/google?")).toBe(true);
    expect(back(t, "next")).toBe(`${APP_RETURN_PATH}?next=${encodeURIComponent("/calendar")}`);
  });
  test("Google sign-in with no or a foreign next goes home", () => {
    expect(back(browserTarget("/api/auth/google"), "next")).toBe(`${APP_RETURN_PATH}?next=${encodeURIComponent("/home")}`);
    expect(back(browserTarget("/api/auth/google?next=https://evil.test/"), "next")).toBe(`${APP_RETURN_PATH}?next=${encodeURIComponent("/home")}`);
  });
  test("an account connect keeps its other params and returns through the app", () => {
    const t = browserTarget("/api/accounts/instagram/connect?returnTo=%2Faccounts&mode=page");
    const u = new URL(t!, "http://x");
    expect(u.pathname).toBe("/api/accounts/instagram/connect");
    expect(u.searchParams.get("mode")).toBe("page");
    expect(u.searchParams.get("returnTo")?.startsWith(`${APP_RETURN_PATH}?next=`)).toBe(true);
  });
  test("anything else is refused (no open redirect, no other API)", () => {
    for (const bad of [
      "https://evil.test/api/auth/google",
      "//evil.test/api/auth/google",
      "/\\evil.test/api/auth/google",
      "/api/auth/logout",
      "/api/accounts/x/disconnect",
      "/api/accounts/../auth/logout/connect",
      "/home",
      "",
      42,
      null,
    ])
      expect(browserTarget(bad)).toBeNull();
  });
  test("a target that already points back at the app is refused, so it can't loop", () => {
    expect(browserTarget(`/api/accounts/x/connect?returnTo=${encodeURIComponent(APP_RETURN_PATH + "?next=/home")}`)).toBeNull();
  });
});

describe("returnTarget", () => {
  test("the page asked for plus whatever the callback added", () => {
    expect(returnTarget(new URLSearchParams("next=%2Faccounts&connected=instagram"))).toBe("/accounts?connected=instagram");
  });
  test("a foreign next never leaves the site", () => {
    const t = returnTarget(new URLSearchParams("next=https%3A%2F%2Fevil.test%2F"));
    expect(t.startsWith("/")).toBe(true);
    expect(t).not.toContain("evil");
  });
});

describe("PKCE handoff codes", () => {
  test("challenge shape and verifier shape", () => {
    expect(validChallenge(CH)).toBe(true);
    expect(validChallenge("short")).toBe(false);
    expect(validVerifier(VERIFIER)).toBe(true);
    expect(validVerifier("x".repeat(42))).toBe(false);
    expect(validVerifier("x".repeat(43) + "!")).toBe(false);
  });
  test("a code only redeems with the verifier that made its challenge", async () => {
    const code = await signCode({ uid: "u1", ch: CH, next: "/calendar" });
    expect(await redeemCode(code, VERIFIER)).toEqual({ uid: "u1", next: "/calendar" });
    expect(await redeemCode(code, VERIFIER.replace("v", "w"))).toBeNull();
    expect(await redeemCode(code, undefined)).toBeNull();
    expect(await redeemCode("not-a-jwt", VERIFIER)).toBeNull();
  });
  test("a code signed out as a start link (other audience) or expired is refused", async () => {
    const start = await signStart({ uid: "u1", to: "/api/auth/google", ch: CH });
    expect(await redeemCode(start, VERIFIER)).toBeNull();
    const old = await new SignJWT({ ch: CH, next: "/home", sub: "u1" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("outlly-app-code")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
      .sign(key());
    expect(await redeemCode(old, VERIFIER)).toBeNull();
  });
  test("a redeemed next is kept on the site", async () => {
    const code = await signCode({ uid: null, ch: CH, next: "//evil.test" });
    const r = await redeemCode(code, VERIFIER);
    expect(r?.uid).toBeNull();
    expect(r?.next.startsWith("//")).toBe(false);
  });
  test("start links round-trip and are refused with the wrong audience", async () => {
    const t = await signStart({ uid: "u2", to: "/api/accounts/youtube/connect?returnTo=x", ch: CH });
    const s = await readStart(t);
    expect(s).toMatchObject({ uid: "u2", to: "/api/accounts/youtube/connect?returnTo=x", ch: CH });
    expect(typeof s?.jti).toBe("string");
    expect(await readStart(await signCode({ uid: "u2", ch: CH, next: "/home" }))).toBeNull();
    expect(await readStart(null)).toBeNull();
  });
  test("a forged start link for another path is refused", async () => {
    const forged = await new SignJWT({ to: "https://evil.test", ch: CH, sub: "u2" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("outlly-app-start")
      .setJti("j")
      .setExpirationTime("1m")
      .sign(key());
    expect(await readStart(forged)).toBeNull();
  });
  test("a start link signs the browser in once only", async () => {
    const u = await mkUser("once");
    expect(await claimStart(u.id, "jti-1")).toBe(true);
    expect(await claimStart(u.id, "jti-1")).toBe(false);
    expect(await claimStart(u.id, "jti-2")).toBe(true);
  });
});

describe("handoff routes", () => {
  test("a bad start link goes back to the app as expired", async () => {
    const res = await startGET(new NextRequest("http://localhost/api/app/start?t=nope"));
    expect(res.headers.get("location")).toBe("outlly://auth?error=expired");
  });
  test("a used start link goes back to the app as expired", async () => {
    const u = await mkUser("used");
    const t = await signStart({ uid: u.id, to: "/api/auth/google", ch: CH });
    const s = await readStart(t);
    await claimStart(u.id, s!.jti);
    const res = await startGET(new NextRequest(`http://localhost/api/app/start?t=${encodeURIComponent(t)}`));
    expect(res.headers.get("location")).toBe("outlly://auth?error=expired");
  });
  test("the return page without the app's challenge cookie hands back nothing", async () => {
    const res = await returnGET(new NextRequest("http://localhost/api/app/return?next=/home"));
    expect(res.headers.get("location")).toBe("outlly://auth?error=expired");
  });
  test("finishing with a wrong verifier is a 400, not a session", async () => {
    const code = await signCode({ uid: "u1", ch: CH, next: "/home" });
    const res = await finishPOST(
      new NextRequest("http://localhost/api/app/finish", { method: "POST", body: JSON.stringify({ code, verifier: "z".repeat(50) }), headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" } }),
      { params: {} } as never,
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("studio_session");
  });
});

test("finishing from another site is blocked", async () => {
  const code = await signCode({ uid: "u1", ch: CH, next: "/home" });
  const res = await finishPOST(
    new NextRequest("http://localhost/api/app/finish", { method: "POST", body: JSON.stringify({ code, verifier: VERIFIER }), headers: { "content-type": "application/json", origin: "https://evil.test", host: "localhost" } }),
    { params: {} } as never,
  );
  expect(res.status).toBe(403);
});

describe("appBounce (a browser flow that ended on a web page goes back to the app)", () => {
  const req = (path: string, cookie = true) => new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie: `ol_app_ch=${CH}` } : {} });
  test("a Google error page or the waitlist inside the app flow returns to the app with that page", () => {
    for (const p of ["/login?google_error=denied", "/waitlist?from=google"]) {
      const loc = new URL(appBounce(req(p))!.headers.get("location")!);
      expect(loc.pathname).toBe(APP_RETURN_PATH);
      expect(loc.searchParams.get("next")).toBe(p);
    }
  });
  test("without the app's cookie, or on any other page, nothing changes", () => {
    expect(appBounce(req("/login?google_error=denied", false))).toBeNull();
    expect(appBounce(req("/login"))).toBeNull();
    expect(appBounce(req("/waitlist"))).toBeNull();
    expect(appBounce(req("/home"))).toBeNull();
  });
});

describe("FCM push", () => {
  test("a tap only ever opens a page on this site", () => {
    expect(fcmMessage("t", { title: "a", body: "b", href: "/inbox" }).message.data.href).toBe("/inbox");
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", null, undefined])
      expect(fcmMessage("t", { title: "a", body: "b", href: bad }).message.data.href).toBe("/home");
  });
  test("long titles and bodies are trimmed, and the Android channel is ours", () => {
    const m = fcmMessage("t", { title: "x".repeat(500), body: "y".repeat(5000) }).message;
    expect(m.notification.title.length).toBe(120);
    expect(m.notification.body.length).toBe(400);
    expect(m.android.notification.channel_id).toBe("outlly_default");
  });
  test("only a token FCM disowns is dropped", () => {
    expect(isDeadToken(404, "")).toBe(true);
    expect(isDeadToken(400, '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}')).toBe(true);
    expect(isDeadToken(400, "The registration token is not a valid FCM registration token")).toBe(true);
    expect(isDeadToken(400, "Invalid JSON payload received")).toBe(false);
    expect(isDeadToken(500, "")).toBe(false);
    expect(isDeadToken(429, "QUOTA_EXCEEDED")).toBe(false);
  });
  test("the service account is read from JSON or base64, anything else is off", () => {
    const j = JSON.stringify({ project_id: "p", client_email: "e@p.iam", private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n" });
    expect(serviceAccount(j)?.private_key).toContain("\nabc\n");
    expect(serviceAccount(Buffer.from(j).toString("base64"))?.project_id).toBe("p");
    expect(serviceAccount("")).toBeNull();
    expect(serviceAccount("{not json")).toBeNull();
    expect(serviceAccount(JSON.stringify({ project_id: "p" }))).toBeNull();
  });
  test("with push not configured nothing is sent and nothing throws", async () => {
    const u = await mkUser("push");
    await db.pushDevice.create({ data: { userId: u.id, token: `tok-${Date.now()}-${"x".repeat(30)}` } });
    expect(await pushToUser(u.id, { title: "Hi", body: "there" })).toEqual({ sent: 0, dropped: 0 });
  });
  test("a device belongs to one account at a time and goes when the account does", async () => {
    const a = await mkUser("pa");
    const b = await mkUser("pb");
    const token = `tok-move-${Date.now()}-${"y".repeat(30)}`;
    await db.pushDevice.upsert({ where: { token }, create: { token, userId: a.id }, update: { userId: a.id } });
    await db.pushDevice.upsert({ where: { token }, create: { token, userId: b.id }, update: { userId: b.id } });
    expect(await db.pushDevice.count({ where: { token } })).toBe(1);
    expect((await db.pushDevice.findUnique({ where: { token } }))?.userId).toBe(b.id);
    await db.user.delete({ where: { id: b.id } });
    expect(await db.pushDevice.count({ where: { token } })).toBe(0);
  });
});
