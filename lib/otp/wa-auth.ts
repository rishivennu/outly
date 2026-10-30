import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { db } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { limitShared, rateLimit } from "../rate-limit";
import { decrypt, encrypt } from "../crypto";
import { getConfig } from "../settings";
import { maskPhone } from "../phone";
import { checkOtp, codeDigest, isCodeShape, newCode, normalizeCode, OTP_MAX_ATTEMPTS, OTP_MESSAGE, OTP_PER_HOUR, OTP_RESEND_MS, OTP_TTL_MS } from "./core";
import { emailChannel } from "./channel";
import { claimCode, deliverPhoneCode, parsePhone, phoneLimits, requireWhatsApp, WA_MESSAGE } from "./whatsapp";

/**
 * Continue with WhatsApp (1060), one flow for sign in AND sign up, that never tells a stranger whether a
 * number or an email has an account:
 *
 *   1. number   Every valid number gets a code. Nobody learns anything from "a code is on its way".
 *   2. code     Proves the number. Has an account: signed in (2FA still applies). No account: only now,
 *               and only to the number's owner, we ask for a name and an email. A sealed, 15-minute
 *               "proof" cookie carries the proven number to the next steps.
 *   3. details  Every email gets a code too, so a new address is proven before it's used and an existing
 *               one can't be told apart from a new one.
 *   4. email    New email: the account is made with both proven. Email already on an account (signed up
 *               with a password or Google): the number is LINKED to that account, never a duplicate, and
 *               that account signs in through its own two-step check.
 */
export const PROOF_COOKIE = "outlly_wa_proof";
export const PROOF_MS = 15 * 60_000;
const PROOF_TAG = "wa-proof";
/** How many different addresses one proven number may send email codes to, and one IP per hour. */
export const PROOF_MAILS = 4;
export const MAILS_PER_IP_HOUR = 10;
/** Sign-in codes cost money and anyone can ask for one: caps per IP (shared NATs are common, so generous) and overall. */
export const WA_SENDS_PER_IP_HOUR = 20;
export const WA_SENDS_PER_DAY = 1000;

export type Proof = { phone: string; nonce: string };

/**
 * Sealed (AES-GCM) so it can't be read or forged: a tag (so another encrypt() output can't pass as a proof),
 * the number, a random nonce and when it runs out. The nonce also lives server-side as an OtpCode row
 * (purpose "wa-proof"), so a proof is single use: spent on success, retired on "Start again", and a copy of
 * the cookie left in a shared browser is worthless after either.
 */
export function sealProof(phone: string, nonce: string, now = Date.now()) {
  return encrypt(JSON.stringify({ t: PROOF_TAG, p: phone, n: nonce, e: now + PROOF_MS }));
}
export function openProof(sealed: string | undefined, now = Date.now()): Proof | null {
  if (!sealed) return null;
  try {
    const v = JSON.parse(decrypt(sealed)) as { t?: string; p?: string; n?: string; e?: number };
    return v.t === PROOF_TAG && typeof v.p === "string" && typeof v.n === "string" && typeof v.e === "number" && v.e > now ? { phone: v.p, nonce: v.n } : null;
  } catch {
    return null;
  }
}
export const PROOF_GONE = "That took a little too long. Start again with your WhatsApp number.";

const proofKey = (phone: string) => `proof:${phone}`;
const proofHash = (nonce: string) => createHmac("sha256", env.AUTH_SECRET).update(`${PROOF_TAG}:${nonce}`).digest("hex");

/** Made when the number is proven (step 2): the row, and the sealed cookie value that points at it. */
export async function startProof(phone: string) {
  const nonce = randomBytes(18).toString("base64url");
  await db.otpCode.create({ data: { email: proofKey(phone), purpose: PROOF_TAG, codeHash: proofHash(nonce), expiresAt: new Date(Date.now() + PROOF_MS) } });
  return sealProof(phone, nonce);
}
/** The proof behind a cookie, if it is still live: sealed by us, not expired, not spent or retired. */
export async function liveProof(sealed: string | undefined): Promise<Proof | null> {
  const p = openProof(sealed);
  if (!p) return null;
  const row = await db.otpCode.findFirst({ where: { email: proofKey(p.phone), purpose: PROOF_TAG, codeHash: proofHash(p.nonce), usedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
  return row ? p : null;
}
/** Spends a proof. True only for the one caller that got it, so a replay can't finish a second account. */
export async function spendProof(p: Proof) {
  const r = await db.otpCode.updateMany({ where: { email: proofKey(p.phone), purpose: PROOF_TAG, codeHash: proofHash(p.nonce), usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  return r.count === 1;
}

/** Step 1. Any valid number gets a code (the per-number and per-day caps in lib/otp/whatsapp still apply). */
export async function sendWhatsAppCode(phoneIn: string, ip = "unknown") {
  const phone = parsePhone(phoneIn);
  await requireWhatsApp();
  await phoneLimits(phone, "login");
  // Per number isn't enough on its own: one caller could walk through many numbers, each a paid message.
  const mine = await limitShared(`otp:wa:ip:${ip}`, WA_SENDS_PER_IP_HOUR, 60 * 60_000);
  if (!mine.ok) throw new HttpError(429, "That's a lot of WhatsApp codes from here. Try again in an hour, or use email.", "OTP_HOURLY");
  const all = await limitShared("otp:wa:all", WA_SENDS_PER_DAY, 24 * 60 * 60_000);
  if (!all.ok) throw new HttpError(503, "WhatsApp codes are busy right now. Use an email code or your password.", "WA_BUSY");
  // A send failure is about WhatsApp (no WhatsApp on that number, Meta down), not about Outlly accounts,
  // so saying so gives nothing away.
  const sent = await deliverPhoneCode(`wa:${phone}`, "login", phone);
  if (!sent.ok) throw new HttpError(502, "WhatsApp didn't take the message. Check the number and that it has WhatsApp, then try again.", "WA_SEND_FAILED");
  return { ok: true as const, phone: maskPhone(phone) };
}

/** Step 2. Returns the account to sign in, or the proven number when there isn't one yet. */
export async function checkWhatsAppCode(phoneIn: string, code: string): Promise<{ userId: string } | { phone: string }> {
  const phone = parsePhone(phoneIn);
  const v = await claimCode(`wa:${phone}`, "login", code);
  if (v !== "ok") throw new HttpError(401, WA_MESSAGE[v as Exclude<typeof v, "ok">] ?? WA_MESSAGE.wrong, `OTP_${v.toUpperCase()}`);
  const user = await db.user.findUnique({ where: { phone }, select: { id: true, phoneVerifiedAt: true } });
  return user?.phoneVerifiedAt ? { userId: user.id } : { phone };
}

const norm = (e: string) => e.trim().toLowerCase();

/**
 * Step 3. A code to ANY address, account or not, so this step can't be used to look emails up. One proven number
 * can mail only a few addresses, and an address that already has an account gets an email that says what is
 * happening (a number being added to it), without the requester's name, so the code can't be phished as a
 * plain sign-in code.
 */
export async function sendEmailProof(emailIn: string, name: string, by: { proof: Proof; ip?: string }) {
  const email = norm(emailIn);
  if (env.NODE_ENV === "production" && (await getConfig("email")).provider === "mock")
    throw new HttpError(503, "Email codes aren't switched on yet, so new accounts can't be made with WhatsApp. Try Google.", "OTP_UNAVAILABLE");
  const cool = rateLimit(`otp:cool:signup:${email}`, 1, OTP_RESEND_MS);
  if (!cool.ok) throw new HttpError(429, `A code is already on its way. You can ask for another in ${cool.retryAfter} seconds.`, "OTP_COOLDOWN");
  const hour = rateLimit(`otp:hour:signup:${email}`, OTP_PER_HOUR, 60 * 60_000);
  if (!hour.ok) throw new HttpError(429, "That's a lot of codes for one address. Try again in an hour.", "OTP_HOURLY");
  const perProof = await limitShared(`otp:wa:mails:${by.proof.nonce}`, PROOF_MAILS, PROOF_MS);
  if (!perProof.ok) throw new HttpError(429, "That's a lot of email addresses for one sign-up. Start again with your WhatsApp number.", "OTP_HOURLY");
  const perIp = await limitShared(`otp:wa:mails:ip:${by.ip ?? "unknown"}`, MAILS_PER_IP_HOUR, 60 * 60_000);
  if (!perIp.ok) throw new HttpError(429, "That's a lot of email codes from here. Try again in an hour.", "OTP_HOURLY");
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  const code = newCode();
  const row = await db.otpCode.create({ data: { email, purpose: "signup", codeHash: codeDigest(env.AUTH_SECRET, "signup", email, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) } });
  const sent = await emailChannel.send(email, code, existing ? { name: null, purpose: "signup", link: true } : { name: name.split(/\s+/)[0] || null, purpose: "signup" });
  if (!sent.ok) {
    await db.otpCode.delete({ where: { id: row.id } }).catch(() => {});
    throw new HttpError(502, "We couldn't send to that email. Check the address and try again.", "EMAIL_SEND_FAILED");
  }
  await db.otpCode.updateMany({ where: { email, purpose: "signup", usedAt: null, id: { not: row.id } }, data: { usedAt: new Date() } });
  return { ok: true as const };
}

/** Step 4, the check half: the code proves the inbox. Single use, 5 tries per code, 10 tries per 15 minutes. */
export async function checkEmailProof(emailIn: string, codeIn: string) {
  const email = norm(emailIn);
  const code = normalizeCode(codeIn);
  if (!isCodeShape(code)) throw new HttpError(400, "Enter the 6-digit code from the email.", "OTP_SHAPE");
  const rl = rateLimit(`otp:verify:signup:${email}`, 10, 15 * 60_000);
  if (!rl.ok) throw new HttpError(429, "Too many tries. Wait a few minutes, then ask for a new code.", "OTP_LOCKED");
  const row = await db.otpCode.findFirst({ where: { email, purpose: "signup" }, orderBy: { createdAt: "desc" } });
  const verdict = checkOtp(row, codeDigest(env.AUTH_SECRET, "signup", email, code));
  if (verdict !== "ok") {
    if (verdict === "wrong" && row) await db.otpCode.updateMany({ where: { id: row.id, attempts: { lt: OTP_MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
    throw new HttpError(401, OTP_MESSAGE[verdict], `OTP_${verdict.toUpperCase()}`);
  }
  const claimed = await db.otpCode.updateMany({ where: { id: row!.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new HttpError(401, OTP_MESSAGE.used, "OTP_USED");
  return email;
}
