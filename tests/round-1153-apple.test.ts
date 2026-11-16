/** 1153: Sign in with Apple. Key handling, the client secret, ID token checks, the callback's cookie bounce and account linking. */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT, createLocalJWKSet, decodeProtectedHeader, exportJWK, exportPKCS8, generateKeyPair, jwtVerify } from "jose";

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

let apple: typeof import("../lib/apple-auth");
let provider: typeof import("../lib/auth-provider");
let db: typeof import("../lib/db").db;
let pkcs8 = "";
let signer: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const { env } = await import("../lib/env");
  const ec = await generateKeyPair("ES256", { extractable: true });
  pkcs8 = await exportPKCS8(ec.privateKey);
  Object.assign(env, { APPLE_CLIENT_ID: "com.outlly.web", APPLE_TEAM_ID: "TEAM123456", APPLE_KEY_ID: "KEY1234567", APPLE_PRIVATE_KEY: pkcs8 });
  const rs = await generateKeyPair("RS256", { extractable: true });
  signer = rs.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(rs.publicKey)), kid: "k1", alg: "RS256" }] });
  apple = await import("../lib/apple-auth");
  provider = await import("../lib/auth-provider");
  db = (await import("../lib/db")).db;
}, 60_000);

const idToken = (claims: Record<string, unknown>, aud = "com.outlly.web", iss = "https://appleid.apple.com") =>
  new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime("5m").sign(signer);

describe("keys and the client secret", () => {
  test("the .p8 is accepted as pasted, on one line with \\n, with spaces for line breaks, or base64", () => {
    const clean = apple.pemFrom(pkcs8);
    expect(clean).toContain("-----BEGIN PRIVATE KEY-----\n");
    expect(apple.pemFrom(pkcs8.replace(/\n/g, "\\n"))).toBe(clean);
    expect(apple.pemFrom(pkcs8.replace(/\n/g, " "))).toBe(clean);
    expect(apple.pemFrom(`"${pkcs8}"`)).toBe(clean);
    expect(apple.pemFrom(Buffer.from(pkcs8).toString("base64"))).toBe(clean);
    expect(apple.pemFrom("")).toBeNull();
    expect(apple.pemFrom("not a key")).toBeNull();
    expect(apple.appleConfigured()).toBe(true);
  });

  test("the client secret is an ES256 JWT Apple can check: kid, iss = team, sub = Services ID, aud = Apple", async () => {
    const jwt = await apple.appleClientSecret();
    expect(decodeProtectedHeader(jwt)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    const { importPKCS8 } = await import("jose");
    const priv = await importPKCS8(apple.pemFrom(pkcs8)!, "ES256", { extractable: true });
    const jwk = await exportJWK(priv);
    delete jwk.d;
    const { payload } = await jwtVerify(jwt, createLocalJWKSet({ keys: [{ ...jwk, alg: "ES256", kid: "KEY1234567" }] }), { issuer: "TEAM123456", audience: "https://appleid.apple.com", subject: "com.outlly.web" });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBeLessThanOrEqual(300);
  });

  test("the authorize URL asks for name and email by form_post, with our state, nonce and return address", () => {
    const u = new URL(apple.appleAuthorizeUrl({ state: "s1", nonce: "n1" }));
    expect(u.origin + u.pathname).toBe("https://appleid.apple.com/auth/authorize");
    expect(u.searchParams.get("response_mode")).toBe("form_post");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("name email");
    expect(u.toString()).toContain("scope=name%20email");
    expect(u.searchParams.get("client_id")).toBe("com.outlly.web");
    expect(u.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/apple\/callback$/);
    expect(u.searchParams.get("state")).toBe("s1");
    expect(u.searchParams.get("nonce")).toBe("n1");
  });
});

describe("the token exchange", () => {
  const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  test("returns the ID token, and sends the code with a signed client secret", async () => {
    let sent: URLSearchParams | null = null;
    const f = (async (_u: string, init: RequestInit) => {
      sent = init.body as URLSearchParams;
      return new Response(JSON.stringify({ id_token: "tok" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await apple.appleExchange("c1", f)).toBe("tok");
    expect(sent!.get("code")).toBe("c1");
    expect(sent!.get("grant_type")).toBe("authorization_code");
    expect(sent!.get("client_secret")!.split(".")).toHaveLength(3);
  });
  test("names the wrong setting: invalid_client is config, invalid_grant is a stale code", async () => {
    await expect(apple.appleExchange("c", answer(400, { error: "invalid_client" }))).rejects.toMatchObject({ reason: "config" });
    await expect(apple.appleExchange("c", answer(400, { error: "invalid_grant" }))).rejects.toMatchObject({ reason: "state" });
    await expect(apple.appleExchange("c", answer(500, {}))).rejects.toMatchObject({ reason: "exchange" });
  });
});

describe("the ID token", () => {
  test("a good token gives sub, a lower-case email and the verified and relay flags (Apple sends them as strings)", async () => {
    const t = await idToken({ sub: "001.abc", email: "Me@PrivateRelay.AppleID.com", email_verified: "true", is_private_email: "true", nonce: "n1" });
    expect(await apple.appleIdentity(t, "n1", jwks)).toEqual({ sub: "001.abc", email: "me@privaterelay.appleid.com", emailVerified: true, relay: true });
  });
  test("a wrong nonce, audience or issuer is refused", async () => {
    await expect(apple.appleIdentity(await idToken({ sub: "x", nonce: "other" }), "n1", jwks)).rejects.toMatchObject({ reason: "state" });
    await expect(apple.appleIdentity(await idToken({ sub: "x", nonce: "n1" }, "com.someone.else"), "n1", jwks)).rejects.toMatchObject({ reason: "exchange" });
    await expect(apple.appleIdentity(await idToken({ sub: "x", nonce: "n1" }, "com.outlly.web", "https://evil.example"), "n1", jwks)).rejects.toMatchObject({ reason: "exchange" });
  });
  test("the first-consent name is read from the user field, and junk is ignored", () => {
    expect(apple.appleName(JSON.stringify({ name: { firstName: "Rishi", lastName: "V" }, email: "x@y.z" }))).toBe("Rishi V");
    expect(apple.appleName("{not json")).toBeUndefined();
    expect(apple.appleName(null)).toBeUndefined();
  });
});

describe("accounts", () => {
  const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  test("a new Apple ID makes a verified studio, needs the 18+ tick, and is found by sub next time even if the email changed", async () => {
    const sub = `001.${tag()}`;
    const email = `apple-${tag()}@privaterelay.appleid.com`;
    await expect(provider.signInWithApple({ sub, email, emailVerified: true, name: "Asha" })).rejects.toMatchObject({ code: "age" });
    const a = await provider.signInWithApple({ sub, email, emailVerified: true, name: "Asha" }, { adult: true });
    expect(a.created).toBe(true);
    const row = await db.user.findUnique({ where: { id: a.id } });
    expect(row?.appleSub).toBe(sub);
    expect(row?.name).toBe("Asha");
    expect(row?.emailVerifiedAt).not.toBeNull();
    const b = await provider.signInWithApple({ sub, email: `changed-${tag()}@icloud.com`, emailVerified: true });
    expect(b).toEqual({ id: a.id, created: false });
  });
  test("an existing studio with the same verified email is linked, not duplicated; unverified or another Apple ID is refused", async () => {
    const email = `link-${tag()}@icloud.com`;
    const u = await db.user.create({ data: { email, name: "Existing" } });
    await expect(provider.signInWithApple({ sub: `001.${tag()}`, email, emailVerified: false })).rejects.toMatchObject({ code: "unverified" });
    const sub = `001.${tag()}`;
    expect(await provider.signInWithApple({ sub, email: email.toUpperCase(), emailVerified: true })).toEqual({ id: u.id, created: false });
    expect((await db.user.findUnique({ where: { id: u.id } }))?.appleSub).toBe(sub);
    await expect(provider.signInWithApple({ sub: `001.${tag()}`, email, emailVerified: true })).rejects.toMatchObject({ code: "apple_other" });
  });
  test("no email at all (and no studio for this sub) is a clear no_email", async () => {
    await expect(provider.signInWithApple({ sub: `001.${tag()}`, email: null, emailVerified: false })).rejects.toMatchObject({ code: "no_email" });
  });
});

describe("wiring", () => {
  const cb = read("app/api/auth/apple/callback/route.ts");
  test("the callback takes Apple's POST, parks it and bounces to a GET with 303, so Lax cookies come along", () => {
    expect(cb).toContain("export async function POST");
    expect(cb).toContain("export async function GET");
    expect(cb).toMatch(/parkAppleForm\(/);
    expect(cb).toMatch(/NextResponse\.redirect\(new URL\(APPLE_CALLBACK_PATH, env\.APP_URL\), 303\)/);
    expect(cb).not.toMatch(/searchParams\.set\("code"/);
  });
  test("the callback keeps the same rules as Google: 2FA, referral, waitlist, maintenance, 18+", () => {
    for (const s of ["beginSignIn(", "attachReferral(", "attachSource(", "captureSignal(", "\"waitlist\"", "\"maintenance\"", "\"age\""]) expect(cb).toContain(s);
  });
  test("both schemas carry appleSub, the button shows only when configured, and every error reason has words", () => {
    for (const s of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) expect(read(s)).toMatch(/appleSub\s+String\?\s+@unique/);
    expect(read("app/(auth)/login/page.tsx")).toContain("apple={appleConfigured()}");
    expect(read("app/(auth)/signup/page.tsx")).toContain("apple={appleConfigured()}");
    const form = read("components/auth/AuthForm.tsx");
    expect(form).toMatch(/\{apple && <AppleButton/);
    for (const r of ["denied", "state", "exchange", "not_configured", "config", "server", "age", "maintenance", "no_email", "unverified", "apple_other"]) expect(form).toMatch(new RegExp(`\\n  ${r}: "`));
    const btn = read("components/auth/AppleButton.tsx");
    expect(btn).toContain("bg-black");
    expect(btn).toContain("dark:bg-white");
    expect(btn).toContain('aria-hidden="true"');
    expect(btn).not.toContain("transition-all");
  });
});
