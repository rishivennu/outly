import "server-only";
import { db } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { limitShared, rateLimit } from "../rate-limit";
import { sendEmail, templates } from "../email";
import { maskPhone, normalizePhone } from "../phone";
import { whatsappAvailable } from "../whatsapp";
import { whatsappChannel } from "./channel";
import { checkOtp, codeDigest, isCodeShape, newCode, normalizeCode, OTP_MAX_ATTEMPTS, OTP_PER_HOUR, OTP_RESEND_MS, OTP_TTL_MS, type OtpPurpose, type OtpVerdict } from "./core";

/**
 * WhatsApp codes. Same codes, hashing and one-use rules as the email ones (lib/otp/core); only the key differs.
 * OtpCode.email holds the key, never an address, so a WhatsApp code can't be spent as an email code:
 *   wa:+91…              sign in with a number already proven on an account
 *   add:<userId>:+91…    prove a number before it's saved on the account
 *   2fa:<userId>         second step of sign-in, sent to the proven number
 * A "reset" code shares the wa: key with sign-in but not the purpose, so one can never be spent as the other.
 */
export const WA_MESSAGE: Record<Exclude<OtpVerdict, "ok">, string> = {
  wrong: "That code doesn't match. Check the latest WhatsApp message from Outlly and try again.",
  expired: "That code has expired. Ask for a new one.",
  used: "That code was already used. Ask for a new one.",
  locked: "Too many wrong tries for that code. Ask for a new one.",
};
/** Each message costs money, so on top of the per-purpose limits a number gets at most this many a day. */
export const WA_PER_DAY = 10;
const BAD_NUMBER = "That number doesn't look right. Use your WhatsApp number with its country code, like +91 98765 43210.";

export function parsePhone(input: string) {
  const p = normalizePhone(input);
  if (!p) throw new HttpError(400, BAD_NUMBER, "PHONE_SHAPE");
  return p;
}

/** Exported names used by lib/otp/wa-auth (Continue with WhatsApp). */
export async function requireOn() {
  if (!(await whatsappAvailable())) throw new HttpError(503, "WhatsApp codes aren't switched on yet. Use an email code or your password.", "WA_UNAVAILABLE");
}

/**
 * Per-number limits, checked before anything else so the answer doesn't depend on whether the number has an account.
 * Shared across server instances (awaited), because every message is paid for: a local-first window would let each
 * instance send one more before the shared block landed.
 */
export async function limits(phone: string, purpose: OtpPurpose) {
  const cool = await limitShared(`otp:wa:cool:${purpose}:${phone}`, 1, OTP_RESEND_MS);
  if (!cool.ok) throw new HttpError(429, `A code is already on its way. You can ask for another in ${cool.retryAfter} seconds.`, "OTP_COOLDOWN");
  const hour = await limitShared(`otp:wa:hour:${purpose}:${phone}`, OTP_PER_HOUR, 60 * 60_000);
  if (!hour.ok) throw new HttpError(429, "That's a lot of codes for one number. Try again in an hour, or use an email code.", "OTP_HOURLY");
  const day = await limitShared(`otp:wa:day:${phone}`, WA_PER_DAY, 24 * 60 * 60_000);
  if (!day.ok) throw new HttpError(429, "That number has had its WhatsApp codes for today. Use an email code or your password.", "OTP_DAILY");
}

/** Makes a code under `key`, sends it to `phone`, and retires older codes for the key once it's delivered. */
export async function deliver(key: string, purpose: OtpPurpose, phone: string): Promise<{ ok: boolean; error?: string }> {
  const code = newCode();
  const row = await db.otpCode.create({ data: { email: key, purpose, codeHash: codeDigest(env.AUTH_SECRET, purpose, key, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) } });
  const sent = await whatsappChannel.send(phone, code, { name: null, purpose });
  if (!sent.ok) {
    await db.otpCode.delete({ where: { id: row.id } }).catch(() => {});
    console.error("[otp:wa] delivery failed", purpose, maskPhone(phone), sent.error); // lib/whatsapp already strips the code
    return sent;
  }
  await db.otpCode.updateMany({ where: { email: key, purpose, usedAt: null, id: { not: row.id } }, data: { usedAt: new Date() } });
  await db.otpCode.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } } }).catch(() => {});
  return { ok: true };
}

/** Checks the latest code under `key` and claims it. Returns the verdict; "ok" means it's now spent. */
export async function claimCode(key: string, purpose: OtpPurpose, codeIn: string): Promise<OtpVerdict> {
  const code = normalizeCode(codeIn);
  if (!isCodeShape(code)) throw new HttpError(400, "Enter the 6-digit code from WhatsApp.", "OTP_SHAPE");
  const rl = rateLimit(`otp:wa:verify:${purpose}:${key}`, 10, 15 * 60_000);
  if (!rl.ok) throw new HttpError(429, "Too many tries. Wait a few minutes, then ask for a new code.", "OTP_LOCKED");
  const row = await db.otpCode.findFirst({ where: { email: key, purpose }, orderBy: { createdAt: "desc" } });
  const verdict = checkOtp(row, codeDigest(env.AUTH_SECRET, purpose, key, code));
  if (verdict !== "ok") {
    if (verdict === "wrong" && row) await db.otpCode.updateMany({ where: { id: row.id, attempts: { lt: OTP_MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
    return verdict;
  }
  const claimed = await db.otpCode.updateMany({ where: { id: row!.id, usedAt: null }, data: { usedAt: new Date() } });
  return claimed.count === 1 ? "ok" : "used";
}
const fail = (v: OtpVerdict) => new HttpError(401, WA_MESSAGE[v as Exclude<OtpVerdict, "ok">] ?? WA_MESSAGE.wrong, `OTP_${v.toUpperCase()}`);

// ------------------------------------------------------------------------------------------------ sign in
/**
 * Same answer whether or not the number is on an account, like the email codes. `reset` is Forgot password
 * by WhatsApp (1060): the same proven number, a code that only works for setting a new password.
 */
export async function issuePhoneLogin(phoneIn: string, purpose: "login" | "reset" = "login") {
  const phone = parsePhone(phoneIn);
  await requireOn();
  await limits(phone, purpose);
  const user = await db.user.findUnique({ where: { phone }, select: { id: true, phoneVerifiedAt: true } });
  if (!user?.phoneVerifiedAt) {
    await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 500)));
    return { ok: true as const };
  }
  await deliver(`wa:${phone}`, purpose, phone); // a failure is logged, not shown: it would confirm the account
  return { ok: true as const };
}

export async function verifyPhoneLogin(phoneIn: string, code: string, purpose: "login" | "reset" = "login") {
  const phone = parsePhone(phoneIn);
  const v = await claimCode(`wa:${phone}`, purpose, code);
  if (v !== "ok") throw fail(v);
  const user = await db.user.findUnique({ where: { phone }, select: { id: true, phoneVerifiedAt: true } });
  if (!user?.phoneVerifiedAt) throw fail("wrong");
  await db.otpCode.deleteMany({ where: { email: `wa:${phone}`, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } } }).catch(() => {});
  return { id: user.id };
}

// ----------------------------------------------------------------------------------------------- settings
export async function securityMail(userId: string, change: "phone" | "phone-off") {
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  if (!u) return;
  await sendEmail({
    to: u.email,
    subject: templates.securitySubject(change),
    html: templates.security({ name: u.name?.split(/\s+/)[0] || null, change, url: `${env.APP_URL}/settings`, at: new Date() }),
    kind: "security",
  }).catch((e) => console.error("[otp:wa] security email failed", e));
}

export async function phoneStatus(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { phone: true, phoneVerifiedAt: true } });
  return { phone: maskPhone(u?.phone), verifiedAt: u?.phoneVerifiedAt?.toISOString() ?? null, available: await whatsappAvailable() };
}

/** Step 1 of adding a number: send it a code. Nothing is saved on the account until the code comes back. */
export async function startPhoneAdd(userId: string, phoneIn: string) {
  const phone = parsePhone(phoneIn);
  await requireOn();
  const mine = rateLimit(`otp:wa:add:${userId}`, 6, 60 * 60_000);
  if (!mine.ok) throw new HttpError(429, "That's a lot of numbers in an hour. Try again later.", "OTP_HOURLY");
  const owner = await db.user.findUnique({ where: { phone }, select: { id: true } });
  if (owner && owner.id !== userId) throw new HttpError(409, "That number is already on another Outlly account.", "PHONE_TAKEN");
  await limits(phone, "phone");
  const sent = await deliver(`add:${userId}:${phone}`, "phone", phone);
  if (!sent.ok) throw new HttpError(502, "WhatsApp didn't take the message. Check the number has WhatsApp, then try again.", "WA_SEND_FAILED");
  return { ok: true as const, phone: maskPhone(phone) };
}

/** Step 2: the code proves the number is yours, and it's saved. */
export async function confirmPhoneAdd(userId: string, phoneIn: string, code: string) {
  const phone = parsePhone(phoneIn);
  const v = await claimCode(`add:${userId}:${phone}`, "phone", code);
  if (v !== "ok") throw fail(v);
  try {
    await db.user.update({ where: { id: userId }, data: { phone, phoneVerifiedAt: new Date() } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new HttpError(409, "That number is already on another Outlly account.", "PHONE_TAKEN");
    throw e;
  }
  await securityMail(userId, "phone");
  return phoneStatus(userId);
}

export async function removePhone(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { phone: true } });
  if (!u?.phone) return phoneStatus(userId);
  await db.user.update({ where: { id: userId }, data: { phone: null, phoneVerifiedAt: null } });
  await securityMail(userId, "phone-off");
  return phoneStatus(userId);
}

// --------------------------------------------------------------------------------------- second step (2FA)
/** Sends the second-step code to the account's proven number. Callers check the halfway sign-in first. */
export async function issueTwoFactor(userId: string, phone: string) {
  await requireOn();
  await limits(phone, "2fa");
  const sent = await deliver(`2fa:${userId}`, "2fa", phone);
  if (!sent.ok) throw new HttpError(502, "WhatsApp didn't take the message. Use your authenticator app or a recovery code.", "WA_SEND_FAILED");
  return { ok: true as const, phone: maskPhone(phone) };
}

export { requireOn as requireWhatsApp, limits as phoneLimits, deliver as deliverPhoneCode };
