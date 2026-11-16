/**
 * Google One Tap: the ID token check (signature, issuer, audience, expiry, claims) against a local key set, and
 * POST /api/auth/google/one-tap against the throwaway database with the token check stubbed through a global.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import * as realOneTap from "../lib/google-one-tap";
import { env } from "../lib/env";

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

// The route takes Google's answer from this global when set; otherwise the real check runs (bun keeps the first mock for the run).
// The namespace import is a live binding the mock replaces, so the real function is pinned here first.
const realIdentity = realOneTap.googleOneTapIdentity;
const realClientId = realOneTap.oneTapClientId;
const g = globalThis as unknown as { __oneTapWho?: realOneTap.GoogleWho | Error };
mock.module("../lib/google-one-tap", () => ({
  ...realOneTap,
  googleOneTapIdentity: async (...args: Parameters<typeof realOneTap.googleOneTapIdentity>) => {
    if (g.__oneTapWho instanceof Error) throw g.__oneTapWho;
    if (g.__oneTapWho) return g.__oneTapWho;
    return realIdentity(...args);
  },
}));

const CLIENT = "123-test.apps.googleusercontent.com";
let signer: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;
let route: typeof import("../app/api/auth/google/one-tap/route");
let db: typeof import("../lib/db").db;
let SESSION_COOKIE = "";
const savedClient = env.YOUTUBE_CLIENT_ID;
const made: string[] = [];

beforeAll(async () => {
  const rs = await generateKeyPair("RS256", { extractable: true });
  signer = rs.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(rs.publicKey)), kid: "g1", alg: "RS256" }] });
  env.YOUTUBE_CLIENT_ID = CLIENT;
  route = await import("../app/api/auth/google/one-tap/route");
  db = (await import("../lib/db")).db;
  SESSION_COOKIE = (await import("../lib/session-cookie")).SESSION_COOKIE;
}, 60_000);

afterAll(async () => {
  env.YOUTUBE_CLIENT_ID = savedClient;
  g.__oneTapWho = undefined;
  if (made.length) await db.user.deleteMany({ where: { email: { in: made } } });
});

const token = (claims: Record<string, unknown>, aud = CLIENT, iss = "https://accounts.google.com", exp = "5m") =>
  new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "g1" }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(signer);

describe("the ID token check", () => {
  const who = { sub: "10001", email: "Person@Example.com", email_verified: true, name: "Person", picture: "https://lh3.example/p.jpg" };

  test("a good token gives sub, email, verified flag, name and picture", async () => {
    const r = await realIdentity(await token(who), CLIENT, jwks);
    expect(r).toEqual({ sub: "10001", email: "Person@Example.com", emailVerified: true, name: "Person", picture: "https://lh3.example/p.jpg" });
  });

  test("Google's two issuer spellings both pass; email_verified must be exactly true", async () => {
    expect((await realIdentity(await token(who, CLIENT, "accounts.google.com"), CLIENT, jwks)).sub).toBe("10001");
    expect((await realIdentity(await token({ ...who, email_verified: "true" }), CLIENT, jwks)).emailVerified).toBe(false);
    expect((await realIdentity(await token({ sub: "1", email: "a@b.c" }), CLIENT, jwks)).name).toBeUndefined();
  });

  test("wrong audience, wrong issuer, expired, unknown key, missing claims and garbage are all one 401 'exchange'", async () => {
    const bad = async (t: string) => {
      try {
        await realIdentity(t, CLIENT, jwks);
      } catch (e) {
        return e as { status?: number; code?: string };
      }
      return null;
    };
    const other = await generateKeyPair("RS256", { extractable: true });
    const foreign = await new SignJWT(who).setProtectedHeader({ alg: "RS256", kid: "g1" }).setIssuer("https://accounts.google.com").setAudience(CLIENT).setIssuedAt().setExpirationTime("5m").sign(other.privateKey);
    for (const t of [
      await token(who, "someone-else.apps.googleusercontent.com"),
      await token(who, CLIENT, "https://appleid.apple.com"),
      await token(who, CLIENT, "https://accounts.google.com", "-1m"),
      foreign,
      await token({ email: "a@b.c" }),
      await token({ sub: "1" }),
      "not.a.jwt",
    ]) {
      const e = await bad(t);
      expect(e?.status).toBe(401);
      expect(e?.code).toBe("exchange");
    }
  });

  test("no client ID configured is a 503 the form can explain, before any token is read", async () => {
    try {
      await realIdentity("x.y.z", "", jwks);
      expect(true).toBe(false);
    } catch (e) {
      expect((e as { status?: number; code?: string }).status).toBe(503);
      expect((e as { code?: string }).code).toBe("not_configured");
    }
  });

  test("the client ID is the same Google client as Continue with Google (YouTube keys)", () => {
    expect(realClientId()).toBe(CLIENT);
  });
});

describe("POST /api/auth/google/one-tap", () => {
  const headers = { origin: "http://localhost", host: "localhost", "content-type": "application/json", "x-forwarded-for": "10.9.8.7" };
  const post = (body: unknown, extra: Record<string, string> = {}) =>
    route.POST(new NextRequest("http://localhost/api/auth/google/one-tap", { method: "POST", body: JSON.stringify(body), headers: { ...headers, ...extra } }), { params: {} } as never);
  const credential = "c".repeat(64);
  const fresh = () => {
    const email = `onetap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    made.push(email);
    return email;
  };

  test("a short or missing credential is refused before Google is asked", async () => {
    jar.clear();
    g.__oneTapWho = new Error("must not be called");
    expect((await post({ credential: "short" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    g.__oneTapWho = undefined;
  });

  test("a new studio with the 18+ tick is made, signed in, and the session cookie is set", async () => {
    jar.clear();
    const email = fresh();
    g.__oneTapWho = { sub: "1", email, emailVerified: true, name: "Tap Person", picture: "https://lh3.example/x.jpg" };
    const res = await post({ credential, adult: true });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, created: true, twoFactor: false });
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    const u = await db.user.findUnique({ where: { email }, select: { name: true, emailVerifiedAt: true, avatar: true } });
    expect(u?.name).toBe("Tap Person");
    expect(u?.emailVerifiedAt).not.toBeNull();
    expect(u?.avatar).toBe("https://lh3.example/x.jpg");
  });

  test("the same Google account again signs in without a second studio", async () => {
    jar.clear();
    const email = made[made.length - 1];
    g.__oneTapWho = { sub: "1", email: email.toUpperCase(), emailVerified: true };
    const res = await post({ credential });
    expect(await res.json()).toEqual({ ok: true, created: false, twoFactor: false });
    expect(await db.user.count({ where: { email } })).toBe(1);
    expect(jar.has(SESSION_COOKIE)).toBe(true);
  });

  test("a new studio without the 18+ tick (body or cookie) is a 403 'age'; the cookie alone is enough", async () => {
    jar.clear();
    const email = fresh();
    g.__oneTapWho = { sub: "2", email, emailVerified: true };
    const refused = await post({ credential });
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe("age");
    expect(await db.user.count({ where: { email } })).toBe(0);
    const viaCookie = await post({ credential }, { cookie: "outlly_adult=1" });
    expect((await viaCookie.json()).created).toBe(true);
  });

  test("an unverified Google email is a 401 'unverified' and makes nothing", async () => {
    jar.clear();
    const email = fresh();
    g.__oneTapWho = { sub: "3", email, emailVerified: false };
    const res = await post({ credential, adult: true });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("unverified");
    expect(await db.user.count({ where: { email } })).toBe(0);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  test("a request from another origin is refused (CSRF), as everywhere else", async () => {
    jar.clear();
    g.__oneTapWho = { sub: "4", email: fresh(), emailVerified: true };
    const res = await post({ credential, adult: true }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("the page side", () => {
  test("the prompt loads Google's script, uses the shared client, and is allowed by the CSP", () => {
    const comp = read("components/auth/GoogleOneTap.tsx");
    const form = read("components/auth/AuthForm.tsx");
    expect(comp).toContain("https://accounts.google.com/gsi/client");
    expect(comp).toContain("/api/auth/google/one-tap");
    expect(comp).toContain("cancel_on_tap_outside: false");
    expect(comp).toContain("use_fedcm_for_prompt");
    expect(comp).toContain("sending.current");
    expect(comp).toContain('addEventListener("error"');
    expect(form).toMatch(/mode === "login" \? step === "password" : adult/);
    expect(form).toContain("active={oneTap}");
    expect(form).toContain("blocked={() => busy || inFlight.current}");
    expect(read("lib/csp.ts")).toMatch(/frame-src[^;\n]*https:\/\/accounts\.google\.com/);
    for (const page of ["app/(auth)/login/page.tsx", "app/(auth)/signup/page.tsx"]) {
      const src = read(page);
      expect(src).toContain("oneTapClientId()");
      expect(src).toContain('hasCredentials("youtube")');
    }
    expect(form).toContain("googleClientId");
    expect(form).toContain("<GoogleOneTap");
  });
});
