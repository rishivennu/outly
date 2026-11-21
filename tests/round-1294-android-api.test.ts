/**
 * R1294: the server side of the Android app (outlly-compose/docs/backend-contract-r1294.md). Routes run against the
 * throwaway database with next/headers on the shared test cookie jar, the same harness as google-one-tap.test.ts.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

type Jar = Map<string, { value: string; opts: Record<string, unknown> }>;
const jar: Jar = ((globalThis as { __testCookieJar?: Jar }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

const APP = { "x-outlly-client": "android/3.0.0+5" };
const WEB = { origin: "http://localhost" };
const VERIFIER = "r".repeat(20) + "-._~" + "B2".repeat(12);

let db: typeof import("../lib/db").db;
let auth: typeof import("../lib/auth");
let handoff: typeof import("../lib/app-handoff");
let idem: typeof import("../lib/idempotency");
let settings: typeof import("../lib/settings");
let SESSION_COOKIE = "";
const R: Record<string, any> = {};
const users: string[] = [];
let n = 0;

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  auth = await import("../lib/auth");
  handoff = await import("../lib/app-handoff");
  idem = await import("../lib/idempotency");
  settings = await import("../lib/settings");
  SESSION_COOKIE = (await import("../lib/session-cookie")).SESSION_COOKIE;
  R.me = await import("../app/api/me/route");
  R.nav = await import("../app/api/me/nav/route");
  R.boot = await import("../app/api/app/bootstrap/route");
  R.limits = await import("../app/api/plan/limits/route");
  R.usage = await import("../app/api/billing/usage/route");
  R.login = await import("../app/api/auth/login/route");
  R.signup = await import("../app/api/auth/signup/route");
  R.verify = await import("../app/api/auth/code/verify/route");
  R.finish = await import("../app/api/app/finish/route");
  R.ret = await import("../app/api/app/return/route");
  R.password = await import("../app/api/settings/password/route");
  R.push = await import("../app/api/app/push/route");
  R.accounts = await import("../app/api/accounts/route");
  R.connect = await import("../app/api/accounts/[platform]/connect/route");
  R.bulk = await import("../app/api/posts/bulk/route");
}, 60_000);

afterAll(async () => {
  jar.clear();
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.setting.deleteMany({ where: { key: { startsWith: "idem:r1294-" } } });
});

const uniq = (tag: string) => `r1294-${tag}-${Date.now()}-${++n}@test.dev`;
async function mkUser(tag: string, password: string | null = "old-password-1") {
  const u = await db.user.create({ data: { name: `R1294 ${tag}`, email: uniq(tag), passwordHash: password ? await auth.hashPassword(password) : null } });
  users.push(u.id);
  return u;
}
async function signInAs(id: string) {
  jar.clear();
  await auth.createSession(id);
  return jar.get(SESSION_COOKIE)!.value;
}
function req(path: string, o: { method?: string; body?: unknown; headers?: Record<string, string>; ip?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost", "x-forwarded-for": o.ip ?? "10.12.94.1", ...(o.body !== undefined ? { "content-type": "application/json" } : {}), ...o.headers };
  const s = jar.get(SESSION_COOKIE)?.value;
  if (s) headers.cookie = `${SESSION_COOKIE}=${s}`;
  return new NextRequest(`http://localhost${path}`, { method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body) });
}
const call = async (h: (r: NextRequest, c: never) => Promise<Response>, r: NextRequest, params: Record<string, string> = {}) => {
  const res = await h(r, { params } as never);
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
};

describe("1. GET /api/app/bootstrap", () => {
  test("signed out: 401 UNAUTHENTICATED", async () => {
    jar.clear();
    const r = await call(R.boot.GET, req("/api/app/bootstrap", { headers: APP }));
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("UNAUTHENTICATED");
  });
  test("one answer with every part, read by the same functions as the single routes", async () => {
    const u = await mkUser("boot");
    await signInAs(u.id);
    const r = await call(R.boot.GET, req("/api/app/bootstrap", { headers: APP }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(r.body)).toEqual(["user", "workspace", "role", "features", "plan", "storage", "team", "profiles", "activeProfileId", "nav", "dashboard", "serverTime"]);
    const me = await call(R.me.GET, req("/api/me", { headers: APP }));
    expect(r.body.user).toEqual(me.body.user);
    expect(r.body.features).toEqual(me.body.features);
    expect(r.body.workspace).toBeNull();
    expect(r.body.role).toBe("owner");
    const limits = await call(R.limits.GET, req("/api/plan/limits"));
    expect(r.body.plan.limits).toEqual(limits.body);
    expect(r.body.plan.id).toBe(limits.body.plan.slug);
    expect(r.body.plan.name).toBe(limits.body.plan.name);
    const usage = await call(R.usage.GET, req("/api/billing/usage"));
    expect(Object.keys(r.body.plan.usage)).toEqual(Object.keys(usage.body));
    expect(r.body.storage).toEqual({ usedBytes: usage.body.storage.usedBytes, limitBytes: usage.body.storage.limitBytes, files: 0 });
    expect(r.body.team.workspaces).toEqual([{ id: u.id, name: u.name, role: "owner", isActive: true }]);
    expect(r.body.profiles).toEqual([]);
    expect(r.body.activeProfileId).toBeNull();
    expect(r.body.nav).toEqual({ style: "sidebar", locked: false, intro: { eligible: true, saved: null } });
    expect(r.body.dashboard).toEqual({ style: "classic", locked: true });
    expect(Math.abs(Date.parse(r.body.serverTime) - Date.now())).toBeLessThan(60_000);
  });
  test("a teammate sees both workspaces, the joined one active", async () => {
    const owner = await mkUser("boot-owner");
    const mate = await mkUser("boot-mate");
    await db.teamMember.create({ data: { ownerId: owner.id, email: mate.email, userId: mate.id, role: "manager", status: "active", tokenHash: `r1294-${Date.now()}`, acceptedAt: new Date() } });
    await signInAs(mate.id);
    jar.set("ol_ws", { value: owner.id, opts: {} });
    const r = await call(R.boot.GET, req("/api/app/bootstrap", { headers: APP }));
    expect(r.body.user.id).toBe(mate.id);
    expect(r.body.workspace.ownerId).toBe(owner.id);
    expect(r.body.team.workspaces).toEqual([
      { id: mate.id, name: mate.name, role: "owner", isActive: false },
      { id: owner.id, name: owner.name, role: "manager", isActive: true },
    ]);
  });
});

describe("2. sign-in answers carry the user for the app, browsers unchanged", () => {
  test("GET /api/me keeps its keys", async () => {
    const u = await mkUser("me");
    await signInAs(u.id);
    const r = await call(R.me.GET, req("/api/me"));
    expect(Object.keys(r.body)).toEqual(["user", "workspace", "role", "features", "renewed"]);
    expect(Object.keys(r.body.user)).toEqual(["id", "name", "email", "avatar", "timezone", "joinedAt"]);
    expect(r.body.features.sellsPlans).toBe(true);
  });
  test("login: the web answer is exactly as before; the app also gets user", async () => {
    const u = await mkUser("login");
    jar.clear();
    const web = await call(R.login.POST, req("/api/auth/login", { method: "POST", headers: WEB, body: { email: u.email, password: "old-password-1" }, ip: "10.12.94.2" }));
    expect(web.status).toBe(200);
    expect(Object.keys(web.body)).toEqual(["ok", "twoFactor"]);
    jar.clear();
    const app = await call(R.login.POST, req("/api/auth/login", { method: "POST", headers: APP, body: { email: u.email, password: "old-password-1" }, ip: "10.12.94.2" }));
    expect(app.body.ok).toBe(true);
    expect(app.body.twoFactor).toBe(false);
    expect(app.body.user).toEqual({ id: u.id, name: u.name, email: u.email, avatar: null, timezone: u.timezone, joinedAt: u.createdAt.toISOString() });
    expect(Object.keys(app.body.user)).toEqual(["id", "name", "email", "avatar", "timezone", "joinedAt"]);
  });
  test("login: a wrong password is BAD_CREDENTIALS, same words", async () => {
    const u = await mkUser("bad");
    jar.clear();
    const r = await call(R.login.POST, req("/api/auth/login", { method: "POST", headers: APP, body: { email: u.email, password: "nope-nope" }, ip: "10.12.94.3" }));
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "That email and password don't match. If you signed up with Google or WhatsApp, use that, or reset your password.", code: "BAD_CREDENTIALS" });
  });
  test("signup: web keeps { ok }, the app gets user, a taken email is EMAIL_TAKEN", async () => {
    jar.clear();
    const email = uniq("signup");
    const web = await call(R.signup.POST, req("/api/auth/signup", { method: "POST", headers: WEB, body: { name: "Web Signup", email, password: "long-enough-1", adult: true }, ip: "10.12.94.4" }));
    expect(web.status).toBe(200);
    expect(web.body).toEqual({ ok: true });
    users.push((await db.user.findUnique({ where: { email } }))!.id);
    jar.clear();
    const email2 = uniq("signup-app");
    const app = await call(R.signup.POST, req("/api/auth/signup", { method: "POST", headers: APP, body: { name: "App Signup", email: email2, password: "long-enough-1", adult: true }, ip: "10.12.94.4" }));
    expect(app.body.ok).toBe(true);
    expect(app.body.user.email).toBe(email2);
    users.push(app.body.user.id);
    jar.clear();
    const taken = await call(R.signup.POST, req("/api/auth/signup", { method: "POST", headers: APP, body: { name: "Again", email, password: "long-enough-1", adult: true }, ip: "10.12.94.4" }));
    expect(taken.status).toBe(409);
    expect(taken.body).toEqual({ error: "That email already has a studio. Try signing in.", code: "EMAIL_TAKEN" });
  });
  test("email code verify: the existing OTP_* codes stay (the web clears the field on /^OTP_/)", async () => {
    const u = await mkUser("otp");
    jar.clear();
    const r = await call(R.verify.POST, req("/api/auth/code/verify", { method: "POST", headers: APP, body: { email: u.email, code: "123456" }, ip: "10.12.94.5" }));
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("OTP_WRONG");
  });
  test("/api/app/finish adds user beside next and signedIn", async () => {
    const u = await mkUser("finish");
    jar.clear();
    const code = await handoff.signCode({ uid: u.id, ch: handoff.challengeOf(VERIFIER), next: "/home" });
    const r = await call(R.finish.POST, req("/api/app/finish", { method: "POST", headers: APP, body: { code, verifier: VERIFIER } }));
    expect(r.status).toBe(200);
    expect(Object.keys(r.body)).toEqual(["next", "signedIn", "user"]);
    expect(r.body.user.id).toBe(u.id);
  });
});

describe("3. POST /api/settings/password", () => {
  const change = (body: unknown, ip = "10.12.94.6") => call(R.password.POST, req("/api/settings/password", { method: "POST", headers: APP, body, ip }));
  test("changes it, keeps this device and signs every other one out", async () => {
    const u = await mkUser("pw");
    const other = await signInAs(u.id);
    await signInAs(u.id);
    const r = await change({ current: "old-password-1", next: "new-password-2" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect((await auth.getCurrentUser())?.id).toBe(u.id);
    jar.set(SESSION_COOKIE, { value: other, opts: {} });
    expect(await auth.getCurrentUser()).toBeNull();
    expect(await db.userSession.count({ where: { userId: u.id } })).toBe(1);
    const { signIn } = await import("../lib/auth-provider");
    expect((await signIn(u.email, "new-password-2")).id).toBe(u.id);
    await expect(signIn(u.email, "old-password-1")).rejects.toThrow();
  });
  test("WEAK_PASSWORD with issues, BAD_CURRENT_PASSWORD, NO_PASSWORD", async () => {
    const u = await mkUser("pw-err");
    await signInAs(u.id);
    const weak = await change({ current: "old-password-1", next: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe("WEAK_PASSWORD");
    expect(weak.body.error).toBe("Use at least 8 characters");
    expect(Array.isArray(weak.body.issues) && weak.body.issues.length).toBeTruthy();
    const wrong = await change({ current: "not-it-at-all", next: "new-password-2" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe("BAD_CURRENT_PASSWORD");
    const g = await mkUser("pw-google", null);
    await signInAs(g.id);
    const none = await change({ current: "anything", next: "new-password-2" });
    expect(none.status).toBe(409);
    expect(none.body.code).toBe("NO_PASSWORD");
  });
  test("5 tries per 15 minutes per person, then 429", async () => {
    const u = await mkUser("pw-rl");
    await signInAs(u.id);
    for (let i = 0; i < 5; i++) expect((await change({ current: "wrong-wrong", next: "new-password-2" }, "10.12.94.7")).status).toBe(403);
    const r = await change({ current: "old-password-1", next: "new-password-2" }, "10.12.94.7");
    expect(r.status).toBe(429);
    expect(r.body.code).toBe("RATE_LIMITED");
  });
  test("signed out: 401", async () => {
    jar.clear();
    expect((await change({ current: "a", next: "new-password-2" })).status).toBe(401);
  });
});

describe("4. DELETE /api/app/push", () => {
  const del = (body?: unknown) => call(R.push.DELETE, req("/api/app/push", { method: "DELETE", headers: APP, body }));
  test("no body: the ol_push cookie path, as before", async () => {
    const u = await mkUser("push-c");
    await signInAs(u.id);
    const d = await db.pushDevice.create({ data: { userId: u.id, token: `r1294-c-${Date.now()}-${"x".repeat(24)}` } });
    jar.set("ol_push", { value: d.id, opts: {} });
    expect((await del()).body).toEqual({ ok: true, removed: 1 });
    expect(await db.pushDevice.count({ where: { id: d.id } })).toBe(0);
    expect((await del()).body).toEqual({ ok: true, removed: 0 });
  });
  test("{ token } removes that token for the person signed in only", async () => {
    const a = await mkUser("push-a");
    const b = await mkUser("push-b");
    const mine = `r1294-a-${Date.now()}-${"y".repeat(24)}`;
    const theirs = `r1294-b-${Date.now()}-${"z".repeat(24)}`;
    await db.pushDevice.create({ data: { userId: a.id, token: mine } });
    await db.pushDevice.create({ data: { userId: b.id, token: theirs } });
    await signInAs(a.id);
    expect((await del({ token: theirs })).body).toEqual({ ok: true, removed: 0 });
    expect(await db.pushDevice.count({ where: { token: theirs } })).toBe(1);
    expect((await del({ token: mine })).body).toEqual({ ok: true, removed: 1 });
    expect(await db.pushDevice.count({ where: { token: mine } })).toBe(0);
    jar.clear();
    expect((await del({ token: theirs })).body).toEqual({ ok: true, removed: 0 });
    expect(await db.pushDevice.count({ where: { token: theirs } })).toBe(1);
  });
});

describe("5. GET /api/me/nav", () => {
  test("style and lock, the same rule POST answers 403 with", async () => {
    const u = await mkUser("nav");
    await signInAs(u.id);
    const before = await settings.getConfig("nav");
    try {
      expect((await call(R.nav.GET, req("/api/me/nav", { headers: APP }))).body).toEqual({ style: "sidebar", locked: false, own: false });
      expect((await call(R.nav.POST, req("/api/me/nav", { method: "POST", headers: APP, body: { style: "dock" } }))).status).toBe(200);
      expect((await call(R.nav.GET, req("/api/me/nav", { headers: APP }))).body).toEqual({ style: "dock", locked: false, own: true });
      await settings.saveConfig("nav", { style: "sidebar", userSwitch: false });
      const locked = await call(R.nav.GET, req("/api/me/nav", { headers: APP }));
      expect(locked.body).toEqual({ style: "sidebar", locked: true, own: false });
      expect((await call(R.nav.POST, req("/api/me/nav", { method: "POST", headers: APP, body: { style: "dock" } }))).status).toBe(403);
    } finally {
      await settings.saveConfig("nav", before);
    }
  });
});

describe("6. handoff errors go back to the app", () => {
  const CH = () => handoff.challengeOf(VERIFIER);
  test("web google_error reasons map to the app's codes", () => {
    const loc = (p: string) => new URL(handoff.handoffErrorFor(p)!.replace("outlly://auth", "http://x/auth"));
    expect(loc("/login?google_error=access_denied").searchParams.get("error")).toBe("cancelled");
    expect(loc("/signup?google_error=age").searchParams.get("error")).toBe("denied");
    expect(loc("/login?google_error=state").searchParams.get("error")).toBe("expired");
    expect(loc("/login?google_error=config").searchParams.get("error")).toBe("provider_error");
    expect(loc("/login?google_error=not_configured").searchParams.get("error")).toBe("provider_error");
    expect(loc("/login?google_error=server").searchParams.get("error")).toBe("server_error");
    expect(loc("/waitlist?from=google").searchParams.get("error")).toBe("denied");
    expect(loc("/waitlist?from=google").searchParams.get("reason")).toBe("waitlist");
    expect(loc("/login?google_error=state").searchParams.get("message")).toBe("That sign-in took too long. Start again from the app.");
    expect(handoff.handoffErrorFor("/home?connected=youtube")).toBeNull();
    expect(handoff.handoffErrorFor("/accounts?connect_error=instagram&reason=denied")).toBeNull();
    expect(handoff.handoffErrorFor("https://evil.test/login?google_error=x")).toBeNull();
    for (const e of handoff.HANDOFF_ERRORS) expect(handoff.appErrorLink(e)).toMatch(new RegExp(`^outlly://auth\\?error=${e}&message=[^&\\s]+$`));
  });
  test("/api/app/return: an error page becomes outlly://auth?error=, not a sign-in code", async () => {
    const next = encodeURIComponent("/login?google_error=access_denied");
    const r = new NextRequest(`http://localhost/api/app/return?next=${next}`, { headers: { cookie: `ol_app_ch=${CH()}`, "sec-fetch-user": "?1" } });
    const res = await R.ret.GET(r);
    expect(res.headers.get("location")).toBe(`outlly://auth?error=cancelled&message=${encodeURIComponent("Sign-in was cancelled.")}&reason=access_denied`);
    const page = await R.ret.GET(new NextRequest(`http://localhost/api/app/return?next=${next}`, { headers: { cookie: `ol_app_ch=${CH()}` } }));
    const html = await page.text();
    expect(html).toContain('href="outlly://auth?error=cancelled');
    expect(html).not.toContain("code=");
  });
  test("a connect whose browser session is gone returns expired to the app, a browser still gets /login", async () => {
    jar.clear();
    const inApp = await R.connect.GET(new NextRequest("http://localhost/api/accounts/instagram/connect", { headers: { cookie: `ol_app_ch=${CH()}` } }), { params: Promise.resolve({ platform: "instagram" }) });
    expect(inApp.headers.get("location")).toStartWith("outlly://auth?error=expired&message=");
    const web = await R.connect.GET(new NextRequest("http://localhost/api/accounts/instagram/connect"), { params: Promise.resolve({ platform: "instagram" }) });
    expect(new URL(web.headers.get("location")!).pathname).toBe("/login");
  });
  test("middleware bounces /signup?google_error inside the app flow too", async () => {
    const { appBounce } = await import("../middleware");
    const b = appBounce(new NextRequest("http://localhost/signup?google_error=age", { headers: { cookie: `ol_app_ch=${CH()}` } }));
    expect(new URL(b!.headers.get("location")!).searchParams.get("next")).toBe("/signup?google_error=age");
    expect(appBounce(new NextRequest("http://localhost/signup?google_error=age"))).toBeNull();
  });
});

describe("7. Idempotency-Key", () => {
  const keyed = (k: string | null) => new NextRequest("http://localhost/api/posts/bulk", { method: "POST", headers: k === null ? {} : { "idempotency-key": k } });
  const okRun = (counter: { n: number }, status = 201) => async () => {
    counter.n++;
    return Response.json({ n: counter.n }, { status });
  };
  test("a repeat with the same key and person gets the stored answer, marked replayed", async () => {
    const c = { n: 0 };
    const k = crypto.randomUUID();
    const first = await idem.idempotent(keyed(k), "r1294-u1", "bulk", okRun(c));
    expect(first.status).toBe(201);
    expect(first.headers.get("Idempotent-Replayed")).toBeNull();
    const again = await idem.idempotent(keyed(k), "r1294-u1", "bulk", okRun(c));
    expect(again.status).toBe(201);
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await again.json()).toEqual({ n: 1 });
    expect(c.n).toBe(1);
    await idem.idempotent(keyed(k), "r1294-u2", "bulk", okRun(c));
    await idem.idempotent(keyed(k), "r1294-u1", "launch:p1", okRun(c));
    expect(c.n).toBe(3);
  });
  test("no key: every call runs, as before", async () => {
    const c = { n: 0 };
    await idem.idempotent(keyed(null), "r1294-u1", "bulk", okRun(c));
    await idem.idempotent(keyed(null), "r1294-u1", "bulk", okRun(c));
    expect(c.n).toBe(2);
  });
  test("a refusal or a throw is not kept, so the retry runs again", async () => {
    const c = { n: 0 };
    const k = crypto.randomUUID();
    expect((await idem.idempotent(keyed(k), "r1294-u3", "bulk", okRun(c, 409))).status).toBe(409);
    await expect(idem.idempotent(keyed(k), "r1294-u3", "bulk", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect((await idem.idempotent(keyed(k), "r1294-u3", "bulk", okRun(c))).status).toBe(201);
    expect(c.n).toBe(2);
  });
  test("in flight: 409 IDEMPOTENCY_IN_PROGRESS; a claim older than 2 minutes is taken over", async () => {
    const k = crypto.randomUUID();
    const key = `idem:r1294-u4:bulk:${k}`;
    await db.setting.create({ data: { key, value: "pending" } });
    const busy = idem.idempotent(keyed(k), "r1294-u4", "bulk", okRun({ n: 0 }));
    await expect(busy).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_IN_PROGRESS" });
    await db.setting.update({ where: { key }, data: { updatedAt: new Date(Date.now() - 3 * 60_000) } });
    expect((await idem.idempotent(keyed(k), "r1294-u4", "bulk", okRun({ n: 0 }))).status).toBe(201);
  });
  test("answers older than 24 hours are swept", async () => {
    const c = { n: 0 };
    const k = crypto.randomUUID();
    await idem.idempotent(keyed(k), "r1294-u5", "bulk", okRun(c));
    await db.setting.update({ where: { key: `idem:r1294-u5:bulk:${k}` }, data: { updatedAt: new Date(Date.now() - idem.IDEMPOTENCY_TTL_MS - 60_000) } });
    const r = await idem.idempotent(keyed(k), "r1294-u5", "bulk", okRun(c));
    expect(r.headers.get("Idempotent-Replayed")).toBeNull();
    expect(c.n).toBe(2);
  });
  test("a key that isn't a UUID-ish token of <= 64 chars is a 400 on the real route", async () => {
    const u = await mkUser("idem");
    await signInAs(u.id);
    const r = await call(R.bulk.POST, req("/api/posts/bulk", { method: "POST", headers: { ...APP, "idempotency-key": "x".repeat(65) }, body: {} }));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("BAD_IDEMPOTENCY_KEY");
    const bad = await call(R.bulk.POST, req("/api/posts/bulk", { method: "POST", headers: { ...APP, "idempotency-key": crypto.randomUUID() }, body: {} }));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION");
  });
  test("launch and bulk both go through it", () => {
    const launch = readFileSync("app/api/posts/[id]/launch/route.ts", "utf8");
    const bulk = readFileSync("app/api/posts/bulk/route.ts", "utf8");
    expect(launch).toContain("idempotent(req, realUserId(user), `launch:${params.id}`, async () => {");
    expect(bulk).toContain('return idempotent(req, realUserId(user), "bulk", async () => json(await bookBatch(');
  });
});

describe("8. GET /api/accounts: expiresAt, needsReauth, scopes", () => {
  test("additive fields per account", async () => {
    const u = await mkUser("acct");
    await signInAs(u.id);
    const soon = new Date(Date.now() + 86_400_000);
    const base = { userId: u.id, accessToken: "x", username: "me" };
    await db.socialAccount.create({ data: { ...base, platform: "youtube", platformUserId: "yt1", tokenExpiresAt: soon, refreshToken: "r", metadata: JSON.stringify({ scopes: ["youtube.upload", "youtube.readonly"] }) } });
    await db.socialAccount.create({ data: { ...base, platform: "instagram", platformUserId: "ig1", status: "needs_reconnect", metadata: JSON.stringify({ scope: "a,b" }) } });
    await db.socialAccount.create({ data: { ...base, platform: "x", platformUserId: "x1", tokenExpiresAt: new Date(Date.now() - 1000), metadata: "not json" } });
    const r = await call(R.accounts.GET, req("/api/accounts"));
    const by = Object.fromEntries(r.body.accounts.map((a: any) => [a.platform, a]));
    expect(Object.keys(by.youtube)).toEqual(["id", "platform", "username", "displayName", "avatar", "status", "mock", "connectedAt", "expiresAt", "needsReauth", "scopes"]);
    expect(by.youtube).toMatchObject({ expiresAt: soon.toISOString(), needsReauth: false, scopes: ["youtube.upload", "youtube.readonly"] });
    expect(by.instagram).toMatchObject({ expiresAt: null, needsReauth: true, scopes: ["a", "b"] });
    expect(by.x).toMatchObject({ needsReauth: true, scopes: [] });
  });
});

describe("9. assetlinks on the apex host", () => {
  test("next.config: the bare domain redirects every path to www except /.well-known/*", async () => {
    const cfg = (await import("../next.config.mjs")).default as { redirects: () => Promise<{ source: string; has: { type: string; value: string }[]; destination: string; permanent: boolean }[]> };
    const [r] = await cfg.redirects();
    expect(r).toMatchObject({ has: [{ type: "host", value: "outlly\\.com" }], destination: "https://www.outlly.com/:path", permanent: true });
    const { getPathMatch } = await import("next/dist/shared/lib/router/utils/path-match");
    const match = getPathMatch(r.source, { strict: true, removeUnnamedParams: true });
    for (const p of ["/", "/home", "/api/health", "/a/b/c", "/.well-knownx"]) expect(match(p)).toBeTruthy();
    for (const p of ["/.well-known/assetlinks.json", "/.well-known/apple-app-site-association", "/.well-known"]) expect(match(p)).toBe(false);
    expect(new RegExp(`^${r.has[0].value}$`).test("www.outlly.com")).toBe(false);
  });
  test("the file is the app's statement and the middleware never touches /.well-known", () => {
    const links = JSON.parse(readFileSync("public/.well-known/assetlinks.json", "utf8"));
    expect(links[0].target.package_name).toBe("com.outlly.app");
    expect(links[0].target.sha256_cert_fingerprints[0]).toStartWith("41:CB:7F");
    expect(readFileSync("middleware.ts", "utf8")).toContain("\\\\.well-known|");
  });
});
