import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { db } from "../db";
import { env } from "../env";
import { decrypt, encrypt } from "../crypto";
import { createSession } from "../auth";
import { HttpError } from "../http";
import { isLimited, rateLimit } from "../rate-limit";
import { sendEmail, templates } from "../email";
import {
  groupKey, isCodeShape, looksLikeRecovery, newRecoveryCodes, newTotpSecret, normalizeCode, otpauthUri, parseHashes,
  recoveryDigest, spendRecovery, verifyTotp,
} from "./core";
import { claimCode, issueTwoFactor, WA_MESSAGE } from "./whatsapp";
import { whatsappAvailable } from "../whatsapp";
import { maskPhone } from "../phone";
import { forgetAllTrusted, forgetThisBrowser, rememberDevice, trustedFor } from "../trusted-device";

/**
 * Two-step sign-in with an authenticator app. After the first step (password, email code or Google) a
 * studio with it turned on gets a short-lived, signed "halfway" cookie instead of a session; the session
 * is only created once the 6-digit app code (or a recovery code) checks out.
 */
export const CHALLENGE_COOKIE = "ol_2fa";
const CHALLENGE_S = 5 * 60;
const secret = new TextEncoder().encode(env.AUTH_SECRET);
const ISSUER = "Outlly";
/** Six wrong codes per person per 15 minutes; right ones don't count. */
const FAILS = [6, 15 * 60_000] as const;
const failKey = (userId: string) => `2fa:fail:${userId}`;
const guard = (userId: string) => {
  if (isLimited(failKey(userId), ...FAILS)) throw new HttpError(429, "Too many wrong codes. Wait a few minutes and try again.", "2FA_LOCKED");
};
const wrong = (userId: string, msg: string) => {
  rateLimit(failKey(userId), ...FAILS);
  return new HttpError(400, msg, "2FA_WRONG");
};

/** Finish a first-step sign-in: a full session, or the second-step challenge if the account asks for one. */
/**
 * Changes whenever a second factor is spent or the setup changes. The halfway cookie carries it, so once a
 * code (or recovery code) has been used, or 2FA was turned off and on again, that cookie is dead.
 */
const fingerprint = (u: { totpEnabledAt: Date | null; totpLastStep: number | null; recoveryCodes: string | null }) =>
  `${u.totpEnabledAt?.getTime() ?? 0}.${u.totpLastStep ?? 0}.${parseHashes(u.recoveryCodes).length}`;

/**
 * `first` says how step one was done. A WhatsApp sign-in code can't also be the second step: that would be
 * the same phone twice, so those sign-ins only get the authenticator app or a recovery code.
 */
export async function beginSignIn(
  userId: string,
  first: "whatsapp" | "other" = "other",
  { remember }: { remember?: boolean } = {},
): Promise<{ twoFactor: boolean; trusted?: boolean }> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true, totpLastStep: true, recoveryCodes: true } });
  // "Don't remember this device" (1053): nothing stays behind, including an older remembered-device cookie.
  if (remember === false) await forgetThisBrowser();
  if (!u?.totpEnabledAt) {
    await createSession(userId, { persist: remember !== false });
    return { twoFactor: false };
  }
  // A device remembered after an earlier full sign-in skips the second step. Only when the person didn't
  // just say "don't remember", and never past its 30 days, a password change or "sign out everywhere".
  if (remember !== false && (await trustedFor(userId))) {
    await createSession(userId);
    return { twoFactor: false, trusted: true };
  }
  const token = await new SignJWT({ sub: userId, p: "2fa", f: fingerprint(u), m: first, r: remember === true ? 1 : remember === false ? 0 : -1 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${CHALLENGE_S}s`).sign(secret);
  cookies().set(CHALLENGE_COOKIE, token, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: CHALLENGE_S });
  return { twoFactor: true };
}

/** "Start over" on the sign-in page: drop the halfway cookie so the next person starts clean. */
export function clearChallenge() {
  cookies().delete(CHALLENGE_COOKIE);
}

async function challengeUser(): Promise<{ id: string; f: string; m: string; r?: boolean }> {
  const t = cookies().get(CHALLENGE_COOKIE)?.value;
  const gone = new HttpError(401, "That sign-in took too long. Start again with your email.", "2FA_EXPIRED");
  if (!t) throw gone;
  try {
    const { payload } = await jwtVerify(t, secret, { algorithms: ["HS256"] });
    if (payload.p !== "2fa" || typeof payload.sub !== "string" || typeof payload.f !== "string") throw gone;
    return { id: payload.sub, f: payload.f, m: typeof payload.m === "string" ? payload.m : "other", r: payload.r === 1 ? true : payload.r === 0 ? false : undefined };
  } catch {
    throw gone;
  }
}

type Factor = { totpSecret: string | null; totpLastStep: number | null; recoveryCodes: string | null };

/**
 * Wrong codes answer 400, not 401: the client treats a 401 outside /api/auth as "signed out" and would
 * bounce a Settings user to the login page.
 *
 * Checks an app code or a recovery code for a user and records it as spent. Returns which one matched.
 * Writes are conditional on the old value, so the same code raced from two tabs only works once.
 */
async function spendFactor(userId: string, u: Factor, input: string): Promise<"totp" | "recovery"> {
  guard(userId);
  if (!u.totpSecret) throw new HttpError(400, "Two-step sign-in isn't set up.", "2FA_OFF");
  const code = normalizeCode(input);
  if (isCodeShape(code)) {
    const step = verifyTotp(decrypt(u.totpSecret), code, Date.now(), u.totpLastStep);
    if (step != null) {
      const r = await db.user.updateMany({ where: { id: userId, totpLastStep: u.totpLastStep }, data: { totpLastStep: step } });
      if (r.count === 1) return "totp";
    }
    throw wrong(userId, "That code doesn't match. Use the newest one in your authenticator app.");
  }
  if (looksLikeRecovery(input)) {
    const left = spendRecovery(parseHashes(u.recoveryCodes), env.AUTH_SECRET, input);
    if (left) {
      const r = await db.user.updateMany({ where: { id: userId, recoveryCodes: u.recoveryCodes }, data: { recoveryCodes: JSON.stringify(left) } });
      if (r.count === 1) return "recovery";
    }
    throw wrong(userId, "That recovery code doesn't match, or it was already used.");
  }
  throw new HttpError(400, "Enter the 6-digit code from your app, or one of your recovery codes.", "2FA_SHAPE");
}

/** The number a WhatsApp second step would go to, or null when that isn't on offer for this sign-in. */
async function whatsappTarget(ch: { id: string; m: string }) {
  if (ch.m === "whatsapp" || !(await whatsappAvailable())) return null;
  const u = await db.user.findUnique({ where: { id: ch.id }, select: { phone: true, phoneVerifiedAt: true } });
  return u?.phone && u.phoneVerifiedAt ? u.phone : null;
}

/** What the second step may use besides the app. Never throws: no halfway sign-in just means no options. */
export async function challengeOptions(): Promise<{ whatsapp: string | null }> {
  try {
    return { whatsapp: maskPhone(await whatsappTarget(await challengeUser())) };
  } catch {
    return { whatsapp: null };
  }
}

/** "Send a code to WhatsApp instead" on the second step. */
export async function sendChallengeWhatsApp() {
  const ch = await challengeUser();
  const phone = await whatsappTarget(ch);
  if (!phone) throw new HttpError(400, "WhatsApp codes aren't available for this sign-in. Use your authenticator app or a recovery code.", "WA_NOT_OFFERED");
  return issueTwoFactor(ch.id, phone);
}

/** Second step of sign-in: app code or recovery code, or (via "whatsapp") the code just sent to the proven number. */
export async function completeSignIn(input: string, via: "app" | "whatsapp" = "app", rememberNow?: boolean) {
  const ch = await challengeUser();
  const userId = ch.id;
  const u = await db.user.findUnique({ where: { id: userId }, select: { totpSecret: true, totpLastStep: true, recoveryCodes: true, totpEnabledAt: true } });
  // Fingerprint moved on: this halfway cookie already finished a sign-in (or 2FA was reset). Start again.
  if (!u?.totpEnabledAt || fingerprint(u) !== ch.f) {
    cookies().delete(CHALLENGE_COOKIE);
    throw new HttpError(401, "That sign-in took too long. Start again with your email.", "2FA_EXPIRED");
  }
  let used: "totp" | "recovery" | "whatsapp";
  if (via === "whatsapp") {
    guard(userId);
    if (!(await whatsappTarget(ch))) throw new HttpError(400, "WhatsApp codes aren't available for this sign-in. Use your authenticator app or a recovery code.", "WA_NOT_OFFERED");
    const v = await claimCode(`2fa:${userId}`, "2fa", input);
    if (v !== "ok") throw wrong(userId, WA_MESSAGE[v as keyof typeof WA_MESSAGE] ?? WA_MESSAGE.wrong);
    used = "whatsapp";
  } else used = await spendFactor(userId, u, input);
  cookies().delete(CHALLENGE_COOKIE);
  const remember = rememberNow ?? ch.r;
  await createSession(userId, { persist: remember !== false });
  if (remember === true) await rememberDevice(userId);
  else if (remember === false) await forgetThisBrowser();
  return { used, recoveryLeft: parseHashes((await db.user.findUnique({ where: { id: userId }, select: { recoveryCodes: true } }))?.recoveryCodes).length };
}

// ----------------------------------------------------------------------------------------------- settings
/** Every change to two-step sign-in gets an email, so a stranger with a borrowed session can't do it quietly. */
async function securityMail(userId: string, change: "on" | "off" | "codes") {
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  if (!u) return;
  await sendEmail({
    to: u.email,
    subject: templates.securitySubject(change),
    html: templates.security({ name: u.name?.split(/\s+/)[0] || null, change, url: `${env.APP_URL}/settings`, at: new Date() }),
    kind: "security",
  }).catch((e) => console.error("[2fa] security email failed", e));
}

export async function status(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true, recoveryCodes: true } });
  return { enabled: !!u?.totpEnabledAt, enabledAt: u?.totpEnabledAt?.toISOString() ?? null, recoveryLeft: parseHashes(u?.recoveryCodes).length };
}

/** New secret for the app. Stored encrypted but not live until a first code proves the app has it. */
export async function startSetup(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, totpEnabledAt: true } });
  if (!u) throw new HttpError(404, "Account not found.");
  if (u.totpEnabledAt) throw new HttpError(409, "Two-step sign-in is already on. Turn it off first to move it to a new phone.", "2FA_ON");
  const key = newTotpSecret();
  await db.user.update({ where: { id: userId }, data: { totpSecret: encrypt(key), totpLastStep: null } });
  return { secret: groupKey(key), uri: otpauthUri({ secret: key, account: u.email, issuer: ISSUER }) };
}

/** First code from the app turns it on and returns the recovery codes, which are shown this one time only. */
export async function enable(userId: string, code: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { totpSecret: true, totpEnabledAt: true } });
  if (!u?.totpSecret) throw new HttpError(400, "Start the setup again to get a fresh QR code.", "2FA_NO_SETUP");
  if (u.totpEnabledAt) throw new HttpError(409, "Two-step sign-in is already on.", "2FA_ON");
  guard(userId);
  const step = verifyTotp(decrypt(u.totpSecret), code);
  if (step == null) throw wrong(userId, "That code doesn't match. Check the time on your phone is set automatically, then try the newest code.");
  const codes = newRecoveryCodes();
  await db.user.update({
    where: { id: userId },
    data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: JSON.stringify(codes.map((c) => recoveryDigest(env.AUTH_SECRET, c))) },
  });
  await forgetAllTrusted(userId); // a fresh second step: no device skips it until it has been used once
  await securityMail(userId, "on");
  return { recoveryCodes: codes };
}

/** Turning it off, or replacing the recovery codes, needs a current code: a borrowed laptop isn't enough. */
export async function disable(userId: string, code: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { totpSecret: true, totpLastStep: true, recoveryCodes: true, totpEnabledAt: true } });
  if (!u?.totpEnabledAt) return { ok: true };
  await spendFactor(userId, u, code);
  await db.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: null } });
  await forgetAllTrusted(userId);
  await securityMail(userId, "off");
  return { ok: true };
}

export async function regenerateRecovery(userId: string, code: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { totpSecret: true, totpLastStep: true, recoveryCodes: true, totpEnabledAt: true } });
  if (!u?.totpEnabledAt) throw new HttpError(400, "Two-step sign-in isn't on.", "2FA_OFF");
  await spendFactor(userId, u, code);
  const codes = newRecoveryCodes();
  await db.user.update({ where: { id: userId }, data: { recoveryCodes: JSON.stringify(codes.map((c) => recoveryDigest(env.AUTH_SECRET, c))) } });
  await securityMail(userId, "codes");
  return { recoveryCodes: codes };
}
