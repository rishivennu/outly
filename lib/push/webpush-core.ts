import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";

/*
 * 1118: Web Push with no third-party library. Two standards, both small enough to own:
 *  - RFC 8291 message encryption ("aes128gcm" content coding): only the browser that subscribed can read a push.
 *  - RFC 8292 VAPID: a JWT signed with our private key tells the push service (Apple, Google, Mozilla, Microsoft)
 *    that the push really comes from Outlly. The private key never leaves the server.
 * Pure (no database, no network), so the encryption is checked end to end in tests by decrypting it again.
 */

export const b64u = {
  enc: (b: Uint8Array) => Buffer.from(b).toString("base64url"),
  dec: (s: string) => Buffer.from(s.replace(/=+$/, ""), "base64url"),
};

const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** HKDF (RFC 5869) with a single expand block, which is all Web Push needs (32 bytes or less). */
export function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, len: number) {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, len);
}

/** The record size we announce. One record holds the whole message (we cap payloads well below it). */
export const RECORD_SIZE = 4096;
/** Push services accept 4096 bytes of body; header (86) + tag (16) + delimiter leave this much for the JSON. */
export const MAX_PLAINTEXT = 3993;

export interface Keys {
  /** The browser's P-256 public key (65 bytes, uncompressed), from PushSubscription.getKey("p256dh"). */
  p256dh: string;
  /** The browser's 16-byte auth secret. */
  auth: string;
}

/** Encrypts one push message for one subscription (RFC 8291 section 3 and 4). `salt` and `local` are for tests. */
export function encrypt(plaintext: Buffer, keys: Keys, opts: { salt?: Buffer; local?: ReturnType<typeof createECDH> } = {}) {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error(`Push payload too large (${plaintext.length} bytes)`);
  const uaPublic = b64u.dec(keys.p256dh);
  const authSecret = b64u.dec(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("Bad p256dh key");
  if (authSecret.length < 16) throw new Error("Bad auth secret");
  const local = opts.local ?? createECDH("prime256v1");
  if (!opts.local) local.generateKeys();
  const asPublic = local.getPublicKey();
  const shared = local.computeSecret(uaPublic);
  const salt = opts.salt ?? randomBytes(16);
  // IKM = HKDF(auth, ecdh, "WebPush: info" || 0 || ua_public || as_public, 32)
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 marks the last (and only) record; no padding.
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

export interface Vapid {
  /** Uncompressed P-256 public key, base64url (what the browser gets as applicationServerKey). */
  publicKey: string;
  /** The 32-byte private scalar, base64url. Server only. */
  privateKey: string;
  /** A contact the push services can reach: https URL or mailto. */
  subject: string;
}

/** A fresh VAPID key pair. */
export function generateVapid(): { publicKey: string; privateKey: string } {
  const e = createECDH("prime256v1");
  e.generateKeys();
  return { publicKey: b64u.enc(e.getPublicKey()), privateKey: b64u.enc(e.getPrivateKey()) };
}

/** True when the pair is well formed and the public key really belongs to the private one. */
export function validVapid(publicKey: string, privateKey: string) {
  try {
    const e = createECDH("prime256v1");
    e.setPrivateKey(b64u.dec(privateKey));
    return b64u.enc(e.getPublicKey()) === publicKey.replace(/=+$/, "");
  } catch {
    return false;
  }
}

/** The VAPID Authorization header for one push service origin (RFC 8292). Valid for an hour at most. */
export function vapidHeader(endpoint: string, v: Vapid, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const pub = b64u.dec(v.publicKey);
  const jwk = { kty: "EC", crv: "P-256", d: v.privateKey.replace(/=+$/, ""), x: b64u.enc(pub.subarray(1, 33)), y: b64u.enc(pub.subarray(33, 65)) };
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  const head = b64u.enc(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.enc(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 3600, sub: v.subject })));
  const data = `${head}.${claims}`;
  const sig = sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${data}.${b64u.enc(sig)}, k=${v.publicKey.replace(/=+$/, "")}`;
}

/** Hosts of the push services browsers actually use. A subscription pointing anywhere else is refused (no SSRF). */
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
];
export function allowedEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((r) => r.test(u.hostname)) && endpoint.length <= 1024;
  } catch {
    return false;
  }
}

/** Topic header: the push service keeps only the newest undelivered message per topic (<= 32 url-safe chars). */
export const topicOf = (tag: string) => createHmac("sha256", "outlly-topic").update(tag).digest("base64url").slice(0, 32);

/** What one push service answer means for the subscription. */
export type Outcome = "sent" | "gone" | "retry" | "rejected";
export function outcomeOf(status: number | null): Outcome {
  if (status === null) return "retry"; // no answer at all: network, DNS, timeout
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone"; // unsubscribed, expired, app removed
  if (status === 429 || status >= 500) return "retry";
  return "rejected"; // 400/401/403/413: our side or a key mismatch; counted, and dropped after a few
}

/** Wait before retry n (1-based): 1, 5, 15, then 60 minutes. Undefined = give up. */
export const RETRY_MINUTES = [1, 5, 15, 60];
export const retryDelayMs = (attempt: number) => (attempt >= 1 && attempt <= RETRY_MINUTES.length ? RETRY_MINUTES[attempt - 1] * 60_000 : undefined);
/** A device that keeps rejecting (4xx other than gone) is dropped after this many in a row. */
export const MAX_REJECTS = 3;
