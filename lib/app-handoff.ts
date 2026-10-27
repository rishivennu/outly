import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import { env } from "./env";
import { safeReturnTo } from "./oauth-state";

/*
 * Google and Meta refuse to show their sign-in pages inside an app WebView, so in the Android app those
 * flows run in a Chrome Custom Tab and the result comes back to the app (PKCE style):
 *   1. app  POST /api/app/handoff {to, challenge}  -> signed start link
 *   2. tab  GET  /api/app/start?t=                 -> same session as the app, remembers the challenge
 *   3. tab  ...Google / Meta / TikTok consent, then the usual callback...
 *   4. tab  GET  /api/app/return                   -> one-time code -> outlly://auth?code=
 *   5. app  POST /api/app/finish {code, verifier}  -> session cookie in the app, then the page it was going to
 * A code is useless without the verifier, which never leaves the app, so another app that registers the
 * outlly:// scheme and catches the code gets nothing.
 */

export const APP_CH_COOKIE = "ol_app_ch";
export const APP_RETURN_PATH = "/api/app/return";
export const APP_DEEP_LINK = "outlly://auth";
export const APP_AUTH_PAGE = "/app-auth";

const START_TTL = 10 * 60;
const CODE_TTL = 5 * 60;
const key = () => new TextEncoder().encode(`${env.AUTH_SECRET}:app-handoff`);

const PKCE = /^[A-Za-z0-9._~-]{43,128}$/;
export const validChallenge = (c: unknown): c is string => typeof c === "string" && /^[A-Za-z0-9_-]{43}$/.test(c);
export const validVerifier = (v: unknown): v is string => typeof v === "string" && PKCE.test(v);

export function challengeOf(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * The browser-only flows the app may start, with their way back pointed at /api/app/return. Anything else
 * (another path, another host) is refused, so the start link can't be turned into an open redirect.
 */
export function browserTarget(to: unknown): string | null {
  if (typeof to !== "string" || !to.startsWith("/") || to.startsWith("//") || to.includes("\\")) return null;
  let u: URL;
  try {
    u = new URL(to, "http://outlly.invalid");
  } catch {
    return null;
  }
  if (u.host !== "outlly.invalid") return null;
  const google = u.pathname === "/api/auth/google";
  const connect = /^\/api\/accounts\/[a-z]{1,20}\/connect$/.test(u.pathname);
  if (!google && !connect) return null;
  const param = google ? "next" : "returnTo";
  const want = u.searchParams.get(param);
  const back = google ? (want && safeReturnTo(want) === want ? want : "/home") : safeReturnTo(want);
  if (back.startsWith(APP_RETURN_PATH)) return null;
  u.searchParams.set(param, `${APP_RETURN_PATH}?next=${encodeURIComponent(back)}`);
  return u.pathname + u.search;
}

/** Where the app lands after the browser part: the page it asked for, plus whatever the callback added (connected=…, welcome=1). */
export function returnTarget(params: URLSearchParams): string {
  const next = safeReturnTo(params.get("next"));
  const u = new URL(next, "http://outlly.invalid");
  params.forEach((v, k) => {
    if (k !== "next") u.searchParams.set(k, v);
  });
  return u.pathname + u.search;
}

export async function signStart(p: { uid: string | null; to: string; ch: string }) {
  return new SignJWT({ to: p.to, ch: p.ch, ...(p.uid ? { sub: p.uid } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("outlly-app-start")
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${START_TTL}s`)
    .sign(key());
}

export async function readStart(t: string | null) {
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, key(), { algorithms: ["HS256"], audience: "outlly-app-start" });
    const to = browserTargetCheck(payload.to);
    if (!to || !validChallenge(payload.ch) || typeof payload.jti !== "string") return null;
    return { uid: typeof payload.sub === "string" ? payload.sub : null, to, ch: payload.ch, jti: payload.jti };
  } catch {
    return null;
  }
}

// A signed start link already carries the rewritten target; re-check its shape, not its return param.
function browserTargetCheck(to: unknown) {
  return typeof to === "string" && /^\/api\/(auth\/google|accounts\/[a-z]{1,20}\/connect)(\?|$)/.test(to) ? to : null;
}

/**
 * A start link signs the browser in as the app's user, so it works once: a copy left in the browser history
 * (or sent to another phone) is dead after the first open.
 */
export async function claimStart(uid: string, jti: string) {
  try {
    await db.featureUse.create({ data: { userId: uid, feature: "app-start", period: "once", ref: jti }, select: { id: true } });
    return true;
  } catch {
    return false;
  }
}

export async function signCode(p: { uid: string | null; ch: string; next: string }) {
  return new SignJWT({ ch: p.ch, next: p.next, ...(p.uid ? { sub: p.uid } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("outlly-app-code")
    .setIssuedAt()
    .setExpirationTime(`${CODE_TTL}s`)
    .sign(key());
}

/** The code from the deep link, checked against the verifier only the app holds. */
export async function redeemCode(code: unknown, verifier: unknown) {
  if (typeof code !== "string" || !validVerifier(verifier)) return null;
  try {
    const { payload } = await jwtVerify(code, key(), { algorithms: ["HS256"], audience: "outlly-app-code" });
    if (payload.ch !== challengeOf(verifier) || typeof payload.next !== "string") return null;
    return { uid: typeof payload.sub === "string" ? payload.sub : null, next: safeReturnTo(payload.next) };
  } catch {
    return null;
  }
}

export const appCookie = (ch: string) => ({
  name: APP_CH_COOKIE,
  value: ch,
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: START_TTL,
});
