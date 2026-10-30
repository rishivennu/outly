/**
 * "Remember this device" (1053), the pure part. Tested in tests/round-1053-trusted.test.ts.
 *
 * The browser holds `id.secret` in an httpOnly cookie; the database keeps only a SHA-256 of the secret, so a
 * leaked database row can't be replayed as a cookie. A remembered device lets a person skip the second step
 * (authenticator or WhatsApp code) on their next sign-in. It never skips the password or email code.
 */
import { createHash, randomBytes } from "node:crypto";

export const TRUST_COOKIE = "outlly_td";
export const TRUST_DAYS = 30;
/** Only sign-in routes read it: /api/auth/* and the Google callback under /api/accounts/*. */
export const TRUST_PATH = "/api";
export const MAX_TRUSTED = 10;

export const newTrustSecret = () => randomBytes(32).toString("base64url");
export const hashTrustSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");
export const trustCookieValue = (id: string, secret: string) => `${id}.${secret}`;

export function parseTrustCookie(v: string | null | undefined): { id: string; secret: string } | null {
  if (!v || v.length > 200) return null;
  const i = v.indexOf(".");
  if (i < 1) return null;
  const id = v.slice(0, i);
  const secret = v.slice(i + 1);
  if (!/^[a-z0-9]{10,40}$/i.test(id) || !/^[A-Za-z0-9_-]{40,60}$/.test(secret)) return null;
  return { id, secret };
}

/** Still good: same person, not past its date, and no "sign out everywhere" or password change since. */
export function trustValid(
  row: { userId: string; secretHash: string; tokenVersion: number; expiresAt: Date } | null,
  want: { userId: string; tokenVersion: number; secret: string },
  now = new Date(),
): boolean {
  if (!row) return false;
  if (row.userId !== want.userId || row.tokenVersion !== want.tokenVersion || row.expiresAt <= now) return false;
  const a = Buffer.from(row.secretHash, "hex");
  const b = Buffer.from(hashTrustSecret(want.secret), "hex");
  return a.length === b.length && a.length > 0 && cryptoEqual(a, b);
}

function cryptoEqual(a: Buffer, b: Buffer) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}
