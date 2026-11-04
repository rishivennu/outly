import "server-only";
import { db } from "../db";
import { env } from "../env";
import { decrypt, encrypt } from "../crypto";
import { generateVapid, validVapid, type Vapid } from "./webpush-core";

/*
 * 1118: where Outlly's VAPID keys come from. VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY in the environment win.
 * Without them the server makes a pair once and keeps it in the Setting table, private half encrypted with
 * TOKEN_ENCRYPTION_KEY, so push works on a fresh deploy with nothing to configure. The private key is never sent
 * to a browser; only the public key is (it is public by design: the browser hands it to its push service).
 */

const KEY = "webpush:vapid";
let cached: Vapid | null = null;

const subject = () => {
  if (env.VAPID_SUBJECT) return env.VAPID_SUBJECT;
  return env.APP_URL.startsWith("https://") ? new URL(env.APP_URL).origin : "mailto:hello@mail.outlly.com";
};

export async function vapidKeys(): Promise<Vapid> {
  if (cached) return cached;
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    if (!validVapid(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)) throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not a matching P-256 pair");
    return (cached = { publicKey: env.VAPID_PUBLIC_KEY.replace(/=+$/, ""), privateKey: env.VAPID_PRIVATE_KEY.replace(/=+$/, ""), subject: subject() });
  }
  const read = async () => {
    const row = await db.setting.findUnique({ where: { key: KEY } });
    if (!row) return null;
    const v = JSON.parse(decrypt(row.value)) as { publicKey: string; privateKey: string };
    return validVapid(v.publicKey, v.privateKey) ? v : null;
  };
  let v = await read();
  if (!v) {
    const fresh = generateVapid();
    // Two cold starts racing: the first insert wins and both read the same pair back.
    await db.setting.create({ data: { key: KEY, value: encrypt(JSON.stringify(fresh)) } }).catch(() => null);
    v = await read();
    if (!v) throw new Error("Could not store the VAPID keys");
  }
  return (cached = { ...v, subject: subject() });
}

/** For tests: forget the in-memory copy. */
export const resetVapidCache = () => void (cached = null);
