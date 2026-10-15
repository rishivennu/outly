import "server-only";
import { db } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { rateLimit } from "../rate-limit";
import { getConfig } from "../settings";
import { checkOtp, codeDigest, isCodeShape, newCode, normalizeCode, OTP_MAX_ATTEMPTS, OTP_MESSAGE, OTP_PER_HOUR, OTP_RESEND_MS, OTP_TTL_MS, type OtpPurpose } from "./core";
import { emailChannel, type OtpChannel } from "./channel";

const norm = (email: string) => email.trim().toLowerCase();

/**
 * Sends a sign-in code if the address has an account. The answer is the same either way (and so are the
 * limits), so this can't be used to find out who has an Outlly account.
 */
export async function issueCode(emailIn: string, purpose: OtpPurpose = "login", channel: OtpChannel = emailChannel) {
  const email = norm(emailIn);
  // Mock email only writes to the admin Outbox, so in production it would just park live codes there.
  // Checked before the account lookup, so the answer is the same for every address.
  if (env.NODE_ENV === "production" && (await getConfig("email")).provider === "mock")
    throw new HttpError(503, "Email sign-in codes aren't switched on yet. Sign in with your password.", "OTP_UNAVAILABLE");
  const cool = rateLimit(`otp:cool:${purpose}:${email}`, 1, OTP_RESEND_MS);
  if (!cool.ok) throw new HttpError(429, `A code is already on its way. You can ask for another in ${cool.retryAfter} seconds.`, "OTP_COOLDOWN");
  const hour = rateLimit(`otp:hour:${purpose}:${email}`, OTP_PER_HOUR, 60 * 60_000);
  if (!hour.ok) throw new HttpError(429, "That's a lot of codes for one address. Try again in an hour, or sign in with your password.", "OTP_HOURLY");

  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true } });
  if (!user) {
    // Roughly as long as a real send, so response time doesn't give the answer away either.
    await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 450)));
    return { ok: true as const };
  }
  const code = newCode();
  const row = await db.otpCode.create({ data: { email, purpose, codeHash: codeDigest(env.AUTH_SECRET, purpose, email, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) } });
  const sent = await channel.send(email, code, { name: user.name?.split(/\s+/)[0] || null });
  if (!sent.ok) {
    // Logged, not shown: an error here (and only here) would tell a stranger the address has an account.
    await db.otpCode.delete({ where: { id: row.id } }).catch(() => {});
    console.error("[otp] delivery failed", sent.error);
    return { ok: true as const };
  }
  // Delivered: now the new code replaces any older one, so only the latest email works.
  await db.otpCode.updateMany({ where: { email, purpose, usedAt: null, id: { not: row.id } }, data: { usedAt: new Date() } });
  await db.otpCode.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } } }).catch(() => {});
  return { ok: true as const };
}

/** Checks the latest code for the address. Returns the user id on success; a code works once. */
export async function verifyCode(emailIn: string, codeIn: string, purpose: OtpPurpose = "login") {
  const email = norm(emailIn);
  const code = normalizeCode(codeIn);
  if (!isCodeShape(code)) throw new HttpError(400, "Enter the 6-digit code from the email.", "OTP_SHAPE");
  // Caps guessing across re-sent codes too: 5 codes an hour x 5 tries, and never more than 10 tries per 15 minutes.
  const rl = rateLimit(`otp:verify:${purpose}:${email}`, 10, 15 * 60_000);
  if (!rl.ok) throw new HttpError(429, "Too many tries. Wait a few minutes, then ask for a new code.", "OTP_LOCKED");

  const row = await db.otpCode.findFirst({ where: { email, purpose }, orderBy: { createdAt: "desc" } });
  const verdict = checkOtp(row, codeDigest(env.AUTH_SECRET, purpose, email, code));
  if (verdict !== "ok") {
    if (verdict === "wrong" && row) await db.otpCode.updateMany({ where: { id: row.id, attempts: { lt: OTP_MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
    throw new HttpError(401, OTP_MESSAGE[verdict], `OTP_${verdict.toUpperCase()}`);
  }
  // Claim it atomically: two tabs submitting the same code can't both get in.
  const claimed = await db.otpCode.updateMany({ where: { id: row!.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new HttpError(401, OTP_MESSAGE.used, "OTP_USED");
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new HttpError(401, OTP_MESSAGE.wrong, "OTP_WRONG");
  // Housekeeping: old rows for this address are no use to anyone.
  await db.otpCode.deleteMany({ where: { email, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } } }).catch(() => {});
  return user;
}
