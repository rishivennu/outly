import "server-only";
import { cookies, headers } from "next/headers";
import { db } from "./db";
import { env } from "./env";
import { deviceLabel, ipPlace, placeLabel } from "./geo";
import { MAX_TRUSTED, TRUST_COOKIE, TRUST_DAYS, TRUST_PATH, hashTrustSecret, newTrustSecret, parseTrustCookie, trustCookieValue, trustValid } from "./trusted-core";

const opts = (maxAge: number) => ({ httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax" as const, path: TRUST_PATH, maxAge });
const clearCookie = () => cookies().set(TRUST_COOKIE, "", opts(0));
const read = () => parseTrustCookie(cookies().get(TRUST_COOKIE)?.value);

/** This browser is a remembered device for this person (and it still counts). Touches its last-used time. */
export async function trustedFor(userId: string): Promise<boolean> {
  const c = read();
  if (!c) return false;
  const [row, u] = await Promise.all([
    db.trustedDevice.findUnique({ where: { id: c.id } }),
    db.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } }),
  ]);
  if (!u || !trustValid(row, { userId, tokenVersion: u.tokenVersion, secret: c.secret })) {
    // Someone else's or a dead one: drop it so it isn't sent again. A dead row of this person's goes too.
    if (row && row.userId === userId) await db.trustedDevice.deleteMany({ where: { id: row.id } });
    clearCookie();
    return false;
  }
  await db.trustedDevice.update({ where: { id: c.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return true;
}

/** Remember this browser after a full sign-in (both steps). Re-remembering refreshes it, it never piles up. */
export async function rememberDevice(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
  if (!u) return;
  const c = read();
  if (c) await db.trustedDevice.deleteMany({ where: { id: c.id, userId } });
  const h = headers();
  const secret = newTrustSecret();
  const row = await db.trustedDevice.create({
    data: {
      userId,
      secretHash: hashTrustSecret(secret),
      tokenVersion: u.tokenVersion,
      label: deviceLabel(h.get("user-agent")),
      place: placeLabel(ipPlace((n) => h.get(n))),
      expiresAt: new Date(Date.now() + TRUST_DAYS * 864e5),
    },
    select: { id: true },
  });
  cookies().set(TRUST_COOKIE, trustCookieValue(row.id, secret), opts(TRUST_DAYS * 86400));
  // Keep the list short: the oldest beyond ten go.
  const extra = await db.trustedDevice.findMany({ where: { userId }, orderBy: { lastUsedAt: "desc" }, skip: MAX_TRUSTED, select: { id: true } });
  if (extra.length) await db.trustedDevice.deleteMany({ where: { id: { in: extra.map((x) => x.id) } } });
}

/** Forget this browser (sign-out, or "Don't remember this device"). */
export async function forgetThisBrowser() {
  const c = read();
  if (c) await db.trustedDevice.deleteMany({ where: { id: c.id } }).catch(() => {});
  if (cookies().get(TRUST_COOKIE)) clearCookie();
}

/** Forget every remembered device (sign out everywhere, 2-step turned on or off). */
export async function forgetAllTrusted(userId: string) {
  await db.trustedDevice.deleteMany({ where: { userId } });
}

/** For Settings > Security. `current` marks the browser asking. */
export async function listTrusted(userId: string) {
  const c = read();
  const u = await db.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
  const rows = await db.trustedDevice.findMany({ where: { userId }, orderBy: { lastUsedAt: "desc" }, select: { id: true, label: true, place: true, createdAt: true, lastUsedAt: true, expiresAt: true, tokenVersion: true } });
  const now = new Date();
  return rows
    .filter((r) => r.expiresAt > now && r.tokenVersion === u?.tokenVersion)
    .map(({ tokenVersion: _v, ...r }) => ({ ...r, current: r.id === c?.id }));
}

export async function revokeTrusted(userId: string, id: string) {
  const r = await db.trustedDevice.deleteMany({ where: { id, userId } });
  if (read()?.id === id) clearCookie();
  return r.count > 0;
}
