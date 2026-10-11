/** Auth provider against a tiny in-memory fake of Supabase GoTrue (HTTP-level, no network). */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let provider: typeof import("../lib/auth-provider");
let auth: typeof import("../lib/auth");
let env: typeof import("../lib/env").env;

type U = { id: string; email: string; password: string; user_metadata: { name?: string } };
const users = new Map<string, U>();
const seen: { path: string; apikey: string | null }[] = [];
const realFetch = globalThis.fetch;

function fakeGoTrue(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input));
  const h = new Headers(init?.headers);
  seen.push({ path: url.pathname, apikey: h.get("apikey") });
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url.pathname === "/auth/v1/admin/users" && init?.method === "POST") {
    if ([...users.values()].some((u) => u.email === body.email)) return json(422, { msg: "A user with this email address has already been registered" });
    if (String(body.password).length < 8) return json(422, { msg: "Password should be at least 8 characters" });
    const u = { id: crypto.randomUUID(), email: body.email, password: body.password, user_metadata: body.user_metadata ?? {} };
    users.set(u.id, u);
    return json(200, u);
  }
  if (url.pathname === "/auth/v1/token") {
    const u = [...users.values()].find((x) => x.email === body.email && x.password === body.password);
    return u ? json(200, { access_token: "at", user: u }) : json(400, { error: "invalid_grant", error_description: "Invalid login credentials" });
  }
  if (url.pathname === "/auth/v1/admin/users") return json(200, { users: [...users.values()] });
  const m = url.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
  if (m && init?.method === "PUT") {
    const u = users.get(m[1])!;
    u.password = body.password;
    return json(200, u);
  }
  return json(404, { msg: "not found" });
}

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  provider = await import("../lib/auth-provider");
  auth = await import("../lib/auth");
  ({ env } = await import("../lib/env"));
});
const useSupabase = () => {
  Object.assign(env, { AUTH_PROVIDER: "supabase", SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test" });
  globalThis.fetch = fakeGoTrue as typeof fetch;
};
afterEach(() => {
  Object.assign(env, { AUTH_PROVIDER: "local", SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" });
  globalThis.fetch = realFetch;
});
afterAll(() => void (globalThis.fetch = realFetch));
const email = (s: string) => `${s}-${Date.now()}@auth.test`;

describe("local auth (offline dev)", () => {
  test("sign up hashes the password; sign in checks it", async () => {
    const e = email("local");
    const { id } = await provider.signUp("Lo", e, "correct-horse");
    const u = await db.user.findUniqueOrThrow({ where: { id } });
    expect(u.passwordHash).toMatch(/^\$2/);
    expect(u.passwordHash).not.toContain("correct-horse");
    expect((await provider.signIn(e.toUpperCase(), "correct-horse")).id).toBe(id);
    await expect(provider.signIn(e, "wrong")).rejects.toThrow(/don't match/);
    await expect(provider.signUp("Lo", e, "again12345")).rejects.toThrow(/already has a studio/);
  });
});

describe("Supabase auth", () => {
  test("sign up creates the identity in Supabase and stores no password locally", async () => {
    useSupabase();
    const e = email("sb");
    const { id } = await provider.signUp("Sb", e, "longenough1");
    const u = await db.user.findUniqueOrThrow({ where: { id } });
    expect(u.passwordHash).toBeNull();
    expect(u.authId).toBeTruthy();
    expect((await provider.signIn(e, "longenough1")).id).toBe(id);
    await expect(provider.signIn(e, "nope")).rejects.toThrow(/don't match/);
  });

  test("password sign-in uses the public anon key, admin calls use the secret key", async () => {
    useSupabase();
    seen.length = 0;
    const e = email("keys");
    await provider.signUp("K", e, "longenough1");
    await provider.signIn(e, "longenough1");
    expect(seen.find((s) => s.path === "/auth/v1/token")?.apikey).toBe("anon-test");
    expect(seen.find((s) => s.path === "/auth/v1/admin/users")?.apikey).toBe("sb_secret_test");
  });

  test("weak password gets friendly copy", async () => {
    useSupabase();
    await expect(provider.signUp("W", email("weak"), "short")).rejects.toThrow(/stronger password/);
  });

  test("a pre-Supabase local account migrates on first sign-in with its old password", async () => {
    const e = email("legacy");
    const { id } = await provider.signUp("Legacy", e, "old-password-1"); // created while AUTH_PROVIDER=local
    useSupabase();
    expect((await provider.signIn(e, "old-password-1")).id).toBe(id);
    const u = await db.user.findUniqueOrThrow({ where: { id } });
    expect(u.authId).toBeTruthy();
    expect(u.passwordHash).toBeNull();
    // Second sign-in goes straight through Supabase.
    expect((await provider.signIn(e, "old-password-1")).id).toBe(id);
    // Wrong password never migrates anything.
    await expect(provider.signIn(e, "guess")).rejects.toThrow(/don't match/);
  });

  test("a legacy account with the wrong password is not migrated", async () => {
    const e = email("legacy2");
    const { id } = await provider.signUp("L2", e, "real-password");
    useSupabase();
    await expect(provider.signIn(e, "wrong-password")).rejects.toThrow(/don't match/);
    const u = await db.user.findUniqueOrThrow({ where: { id } });
    expect(u.authId).toBeNull();
    expect(u.passwordHash).not.toBeNull();
  });
});

describe("session tokens", () => {
  test("hashPassword/verifyPassword", async () => {
    const h = await auth.hashPassword("pw-123456");
    expect(await auth.verifyPassword("pw-123456", h)).toBe(true);
    expect(await auth.verifyPassword("pw-1234567", h)).toBe(false);
  });
});
