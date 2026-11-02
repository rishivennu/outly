import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import { env } from "./env";
import { safeReturnTo } from "./oauth-state";
import { decrypt, encrypt } from "./crypto";
import type { Platform } from "./domain";
import type { ConnectedProfile } from "./social/types";

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
    if (k !== "next" && k !== "hold") u.searchParams.set(k, v);
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
  return claimOnce(uid, "app-start", jti);
}

export async function signCode(p: { uid: string | null; ch: string; next: string; hold?: string | null }) {
  return new SignJWT({ ch: p.ch, next: p.next, ...(p.uid ? { sub: p.uid } : {}), ...(p.hold ? { hold: p.hold } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("outlly-app-code")
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${CODE_TTL}s`)
    .sign(key());
}

/** The code from the deep link, checked against the verifier only the app holds. */
export async function redeemCode(code: unknown, verifier: unknown) {
  if (typeof code !== "string" || !validVerifier(verifier)) return null;
  try {
    const { payload } = await jwtVerify(code, key(), { algorithms: ["HS256"], audience: "outlly-app-code" });
    if (payload.ch !== challengeOf(verifier) || typeof payload.next !== "string" || typeof payload.jti !== "string") return null;
    const uid = typeof payload.sub === "string" ? payload.sub : null;
    // One use (1086): a copied code can't mint a second session for the same person.
    if (uid && !(await claimOnce(uid, "app-code", payload.jti))) return null;
    return { uid, ch: payload.ch as string, next: safeReturnTo(payload.next), hold: typeof payload.hold === "string" && HOLD_ID.test(payload.hold) ? payload.hold : null };
  } catch {
    return null;
  }
}

async function claimOnce(uid: string, feature: string, jti: string) {
  try {
    await db.featureUse.create({ data: { userId: uid, feature, period: "once", ref: jti }, select: { id: true } });
    return true;
  } catch {
    return false;
  }
}

/*
 * Held connects (security 1086). A start link signs the Custom Tab in as the app's user, so the link alone
 * must never be enough to attach an account: anyone can mint one for their own studio and send it to
 * someone else, whose Instagram would then land in the sender's workspace. So a connect that began in the
 * app is not saved by the callback. It is held here, bound to that user and the app's challenge, and only
 * /api/app/finish saves it, with the verifier that never left the phone that started the flow.
 */
const HOLD_PREFIX = "app-hold:";
const HOLD_TTL_MS = 15 * 60_000;
export const HOLD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Held = { uid: string; ch: string; platform: Platform; prof: ConnectedProfile };

/** Expired holds carry encrypted tokens, so they're swept on every hold and every take. */
const sweepHolds = () =>
  db.setting.deleteMany({ where: { key: { startsWith: HOLD_PREFIX }, updatedAt: { lt: new Date(Date.now() - HOLD_TTL_MS) } } }).catch(() => {});

export async function holdConnect(h: Held): Promise<string> {
  const id = randomUUID();
  await sweepHolds();
  await db.setting.create({ data: { key: HOLD_PREFIX + id, value: encrypt(JSON.stringify(h)) } });
  return id;
}

/** The held connect, once: only for the same user and challenge, and only while it is fresh. */
export async function takeHeld(id: string, uid: string | null, ch: string): Promise<Held | null> {
  if (!HOLD_ID.test(id) || !uid) return null;
  await sweepHolds();
  const row = await db.setting.findUnique({ where: { key: HOLD_PREFIX + id } });
  if (!row) return null;
  const gone = await db.setting.deleteMany({ where: { key: HOLD_PREFIX + id, updatedAt: row.updatedAt } });
  if (gone.count !== 1 || Date.now() - row.updatedAt.getTime() > HOLD_TTL_MS) return null;
  try {
    const h = JSON.parse(decrypt(row.value)) as Held;
    if (h.uid !== uid || h.ch !== ch) return null;
    if (h.prof.expiresAt) h.prof.expiresAt = new Date(h.prof.expiresAt);
    return h;
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
