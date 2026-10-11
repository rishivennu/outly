import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

const KEY = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
if (KEY.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Malformed encrypted payload");
  const d = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export function hmac(data: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(data).digest("base64url");
}

/** Keyless digest for things we must be able to look up but never store in the clear (review links). */
export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
