/**
 * One-time codes, with no third party in the loop (2026-10-15).
 *
 * Two kinds live here, both pure so they can be unit tested:
 * - Email codes: 6 random digits, stored only as a keyed hash, 10 minutes, 5 tries, single use.
 * - Authenticator codes (TOTP, RFC 6238): the same scheme Google Authenticator, 1Password and Authy use.
 *   A shared secret is shown once as a QR code; the app and the server then derive the same 6 digits
 *   every 30 seconds from the clock, so nothing is sent at sign-in time.
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// ------------------------------------------------------------------------------------------------ email codes
export const OTP_DIGITS = 6;
export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
/** One new code per address per minute, and a few an hour, whoever asks. */
export const OTP_RESEND_MS = 60_000;
export const OTP_PER_HOUR = 5;

/** "reset" codes only set a new password; they never sign anyone in on their own. */
export type OtpPurpose = "login" | "reset";

/** Uniform 6 digits from the OS random source (randomInt has no modulo bias). */
export function newCode(): string {
  return String(randomInt(0, 10 ** OTP_DIGITS)).padStart(OTP_DIGITS, "0");
}

/** People paste "123 456" or "123-456". Keep digits only. */
export function normalizeCode(input: string): string {
  return String(input ?? "").replace(/[\s-]/g, "");
}
export const isCodeShape = (s: string) => /^\d{6}$/.test(s);

/** Keyed hash: a leaked table of hashes can't be brute-forced offline without the server secret. */
export function codeDigest(key: string, purpose: string, email: string, code: string): string {
  return createHmac("sha256", key).update(`otp:${purpose}:${email.trim().toLowerCase()}:${code}`).digest("base64url");
}

export function sameDigest(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export interface OtpRow {
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  usedAt: Date | null;
}
export type OtpVerdict = "ok" | "wrong" | "expired" | "used" | "locked";

/** The order matters: a used, expired or locked code says so even if the digits match. */
export function checkOtp(row: OtpRow | null | undefined, digest: string, now = new Date()): OtpVerdict {
  if (!row) return "wrong";
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.attempts >= OTP_MAX_ATTEMPTS) return "locked";
  return sameDigest(row.codeHash, digest) ? "ok" : "wrong";
}

export const OTP_MESSAGE: Record<Exclude<OtpVerdict, "ok">, string> = {
  wrong: "That code doesn't match. Check the latest email and try again.",
  expired: "That code has expired. Ask for a new one.",
  used: "That code was already used. Ask for a new one.",
  locked: "Too many wrong tries for that code. Ask for a new one.",
};

// --------------------------------------------------------------------------------------------- base32 (RFC 4648)
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const s = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Not a base32 key");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ------------------------------------------------------------------------------------------------- TOTP (RFC 6238)
export const TOTP_STEP_S = 30;
export const TOTP_WINDOW = 1; // accept the previous and next step too (clock drift, slow typing)

/** 160-bit secret, the size RFC 4226 recommends for HMAC-SHA1. 32 base32 characters. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const stepAt = (ms: number) => Math.floor(ms / 1000 / TOTP_STEP_S);

/** RFC 4226 HOTP: HMAC-SHA1 over the 8-byte counter, then dynamic truncation. */
export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const totp = (secretB32: string, ms = Date.now(), digits = 6) => hotp(base32Decode(secretB32), stepAt(ms), digits);

/**
 * Checks a code against the steps around now. Returns the matching step, or null. A step at or before
 * `lastStep` is refused, so a code someone watched you type can't be replayed in the same 30 seconds.
 */
export function verifyTotp(secretB32: string, code: string, ms = Date.now(), lastStep?: number | null, window = TOTP_WINDOW): number | null {
  const c = normalizeCode(code);
  if (!isCodeShape(c)) return null;
  const key = base32Decode(secretB32);
  const now = stepAt(ms);
  let hit: number | null = null;
  // Check every step in the window (no early exit), so timing doesn't say which one matched.
  for (let s = now - window; s <= now + window; s++) {
    if (sameDigest(hotp(key, s), c) && (lastStep == null || s > lastStep) && hit === null) hit = s;
  }
  return hit;
}

/** The link authenticator apps read from the QR code (Key Uri Format). */
export function otpauthUri(o: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${o.issuer}:${o.account}`);
  const q = new URLSearchParams({ secret: o.secret, issuer: o.issuer, algorithm: "SHA1", digits: "6", period: String(TOTP_STEP_S) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** "ABCD EFGH ..." so the key can be typed by hand. */
export const groupKey = (s: string) => s.replace(/(.{4})(?=.)/g, "$1 ");

// --------------------------------------------------------------------------------------------- recovery codes
/** No 0/O, 1/I/L: these get read off paper. */
const RC = "abcdefghjkmnpqrstuvwxyz23456789";
export const RECOVERY_COUNT = 10;

export function newRecoveryCodes(n = RECOVERY_COUNT): string[] {
  return Array.from({ length: n }, () => {
    let s = "";
    for (let i = 0; i < 10; i++) s += RC[randomInt(0, RC.length)];
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const normalizeRecovery = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const looksLikeRecovery = (s: string) => normalizeRecovery(s).length === 10 && !isCodeShape(normalizeCode(s));

export const recoveryDigest = (key: string, code: string) => createHmac("sha256", key).update(`rc:${normalizeRecovery(code)}`).digest("base64url");

/** Finds and removes a recovery code. Returns the remaining list, or null when it doesn't match. */
export function spendRecovery(hashes: string[], key: string, code: string): string[] | null {
  const d = recoveryDigest(key, code);
  let idx = -1;
  hashes.forEach((h, i) => {
    if (sameDigest(h, d) && idx < 0) idx = i;
  });
  return idx < 0 ? null : hashes.filter((_, i) => i !== idx);
}

export function parseHashes(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
