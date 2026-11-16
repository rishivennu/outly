import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify, type JWTVerifyGetKey } from "jose";
import { decrypt, encrypt, safeEqual } from "./crypto";
import { env } from "./env";

/**
 * Sign in with Apple (1153), the web flow: our button sends the visitor to Apple, Apple POSTs the answer back
 * (response_mode=form_post, the only mode that may ask for name and email), we swap the code for an ID token
 * with a client secret we sign ourselves, and the ID token says who it is. Configured by four env vars; with any
 * of them missing the button is not shown and the routes answer "not_configured".
 */
export const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_CALLBACK_PATH = "/api/auth/apple/callback";
const COOKIE_PATH = "/api/auth/apple";
const STATE_COOKIE = "oauth_apple";
const FORM_COOKIE = "apple_form";

export class AppleError extends Error {
  constructor(public reason: "config" | "state" | "exchange" | "denied", public technical = "") {
    super(`Sign in with Apple: ${reason}`);
  }
}

export function appleKeys() {
  return { clientId: env.APPLE_CLIENT_ID.trim(), teamId: env.APPLE_TEAM_ID.trim(), keyId: env.APPLE_KEY_ID.trim(), privateKey: env.APPLE_PRIVATE_KEY };
}

/** All four pieces are there and the key at least looks like a .p8 file. */
export function appleConfigured() {
  const k = appleKeys();
  return !!(k.clientId && k.teamId && k.keyId && pemFrom(k.privateKey));
}

/**
 * The .p8 file however it was pasted into Vercel: as is, on one line with literal \n, with the line breaks
 * turned into spaces, quoted, or base64 encoded. Returns a clean PKCS#8 PEM, or null when it isn't one.
 */
export function pemFrom(raw: string | undefined | null): string | null {
  let v = (raw ?? "").trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
  if (!v) return null;
  if (!/BEGIN PRIVATE KEY/.test(v)) {
    const d = Buffer.from(v.replace(/\s+/g, ""), "base64").toString("utf8");
    if (!/BEGIN PRIVATE KEY/.test(d)) return null;
    v = d;
  }
  const m = v.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
  const body = m?.[1].replace(/\s+/g, "") ?? "";
  if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) return null;
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/** Apple's "client secret" is a short-lived ES256 JWT signed with the .p8 key (we make a fresh one per sign-in). */
export async function appleClientSecret(now = Math.floor(Date.now() / 1000)) {
  const k = appleKeys();
  const pem = pemFrom(k.privateKey);
  if (!pem) throw new AppleError("config", "APPLE_PRIVATE_KEY is not a PKCS#8 .p8 key");
  const key = await importPKCS8(pem, "ES256").catch((e) => {
    throw new AppleError("config", `APPLE_PRIVATE_KEY did not import: ${(e as Error).message}`);
  });
  return new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: k.keyId }).setIssuer(k.teamId).setSubject(k.clientId).setAudience(APPLE_ISSUER).setIssuedAt(now).setExpirationTime(now + 300).sign(key);
}

export const appleRedirectUri = () => `${env.APP_URL}${APPLE_CALLBACK_PATH}`;
export const randomToken = () => randomBytes(24).toString("base64url");

export function appleAuthorizeUrl({ state, nonce }: { state: string; nonce: string }) {
  const q = new URLSearchParams({ client_id: appleKeys().clientId, redirect_uri: appleRedirectUri(), response_type: "code", response_mode: "form_post", scope: "name email", state, nonce });
  return `${APPLE_ISSUER}/auth/authorize?${q.toString().replace(/\+/g, "%20")}`;
}

/** Code -> ID token, server to server. The token endpoint's error names which setting is wrong. */
export async function appleExchange(code: string, fetcher: typeof fetch = fetch): Promise<string> {
  const body = new URLSearchParams({ client_id: appleKeys().clientId, client_secret: await appleClientSecret(), code, grant_type: "authorization_code", redirect_uri: appleRedirectUri() });
  let r: Response;
  try {
    r = await fetcher(`${APPLE_ISSUER}/auth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body, signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    throw new AppleError("exchange", `token request failed: ${(e as Error).message}`);
  }
  const j = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (r.ok && typeof j.id_token === "string") return j.id_token;
  const err = j.error ?? `http_${r.status}`;
  throw new AppleError(err === "invalid_client" || err === "unauthorized_client" ? "config" : err === "invalid_grant" ? "state" : "exchange", `token ${r.status} ${err}`);
}

const appleJwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

export interface AppleWho {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  /** Hide My Email: an @privaterelay.appleid.com address that forwards to the real inbox. */
  relay: boolean;
}

/** Checks Apple's signature, issuer, audience (our Services ID), expiry and the nonce we sent. */
export async function appleIdentity(idToken: string, nonce: string, keys: JWTVerifyGetKey = appleJwks): Promise<AppleWho> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, keys, { issuer: APPLE_ISSUER, audience: appleKeys().clientId, algorithms: ["RS256", "ES256"] }));
  } catch (e) {
    throw new AppleError("exchange", `id_token: ${(e as Error).message}`);
  }
  if (typeof payload.nonce !== "string" || !safeEqual(payload.nonce, nonce)) throw new AppleError("state", "nonce mismatch");
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) throw new AppleError("exchange", "id_token has no sub");
  const yes = (v: unknown) => v === true || v === "true";
  const email = typeof payload.email === "string" && payload.email.includes("@") ? payload.email.trim().toLowerCase() : null;
  return { sub, email, emailVerified: yes(payload.email_verified), relay: yes(payload.is_private_email) };
}

/** Apple sends the name once, on the very first consent, as JSON in the `user` form field. */
export function appleName(user: string | null | undefined): string | undefined {
  if (!user) return undefined;
  try {
    const n = (JSON.parse(user) as { name?: { firstName?: unknown; lastName?: unknown } }).name;
    const s = [n?.firstName, n?.lastName].filter((x): x is string => typeof x === "string").join(" ").replace(/\s+/g, " ").trim();
    return s ? s.slice(0, 80) : undefined;
  } catch {
    return undefined;
  }
}

export interface ApplePending {
  state: string;
  nonce: string;
  returnTo: string;
  from: "login" | "signup";
  remember?: boolean;
  exp: number;
}

const cookieOpts = (maxAge: number) => ({ httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax" as const, path: COOKIE_PATH, maxAge });

export async function saveAppleState(v: Omit<ApplePending, "exp">) {
  (await cookies()).set(STATE_COOKIE, encrypt(JSON.stringify({ ...v, exp: Date.now() + 10 * 60_000 })), cookieOpts(600));
}

export async function takeAppleState(state: string | null): Promise<ApplePending | null> {
  const jar = await cookies();
  const raw = jar.get(STATE_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: COOKIE_PATH });
  if (!raw || !state) return null;
  try {
    const v = JSON.parse(decrypt(raw)) as ApplePending;
    return v.exp > Date.now() && safeEqual(v.state, state) ? v : null;
  } catch {
    return null;
  }
}

export interface AppleForm {
  code: string | null;
  state: string | null;
  user: string | null;
  error: string | null;
}

/**
 * Apple's answer is a cross-site POST, and browsers leave our SameSite=Lax cookies (the state, the 18+ tick,
 * the time zone, a remembered device) off it. So the POST only parks the form in a two-minute cookie and
 * bounces to a GET of the same path, which is a top-level navigation and does carry them. The code never
 * goes in a URL.
 */
export async function parkAppleForm(f: AppleForm) {
  (await cookies()).set(FORM_COOKIE, encrypt(JSON.stringify(f)), cookieOpts(120));
}

export async function takeAppleForm(): Promise<AppleForm | null> {
  const jar = await cookies();
  const raw = jar.get(FORM_COOKIE)?.value;
  jar.delete({ name: FORM_COOKIE, path: COOKIE_PATH });
  if (!raw) return null;
  try {
    return JSON.parse(decrypt(raw)) as AppleForm;
  } catch {
    return null;
  }
}
