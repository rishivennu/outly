import "server-only";
import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { db } from "../db";
import { env } from "../env";
import { clientIp } from "../http";

/*
 * 1147: anti-abuse signals. Only one-way hashes are stored (HMAC-SHA256 with OFFER_PEPPER), never a raw IP,
 * device id or user agent. No fingerprinting: the device id is a random first-party cookie set by middleware.ts.
 */

export const DEVICE_COOKIE = "oly_did";
export const SIGNAL_KEEP_DAYS = 90;
export type SignalEvent = "signup" | "trial" | "checkout";

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pepper = () => process.env.OFFER_PEPPER || env.AUTH_SECRET;
/** Scoped so the same raw value never hashes the same way for two different signal kinds. */
export const signalHash = (scope: "ip" | "net" | "device" | "ua", raw: string) => createHmac("sha256", pepper()).update(`${scope}:${raw}`).digest("base64url");

function expandV6(ip: string): string[] | null {
  const [head, tail = ""] = ip.split("::");
  const a = head ? head.split(":") : [];
  const b = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  if (!ip.includes("::") && a.length !== 8) return null;
  const fill = 8 - a.length - b.length;
  if (fill < 0) return null;
  const parts = [...a, ...Array(ip.includes("::") ? fill : 0).fill("0"), ...b];
  return parts.every((p) => /^[0-9a-f]{1,4}$/i.test(p)) ? parts.map((p) => p.toLowerCase().replace(/^0+(?=.)/, "")) : null;
}

/** The network a visitor shares with neighbours: /24 for IPv4, /48 for IPv6. Anything unparseable is its own network. */
export function networkPrefix(ipIn: string): string {
  const ip = ipIn.trim().replace(/^\[|\]$/g, "").split("%")[0];
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  const v6 = ip.includes(":") ? expandV6(ip) : null;
  if (v6) return `${v6.slice(0, 3).join(":")}::/48`;
  return ip.toLowerCase();
}

/** Browser family and OS from the User-Agent, coarse on purpose (no version numbers). */
export function uaFamily(ua: string | null | undefined): string {
  const s = ua ?? "";
  const os = /android/i.test(s) ? "android" : /iphone|ipad|ipod/i.test(s) ? "ios" : /windows/i.test(s) ? "windows" : /mac os x|macintosh/i.test(s) ? "mac" : /cros/i.test(s) ? "chromeos" : /linux/i.test(s) ? "linux" : "other";
  const browser = /edg\//i.test(s) ? "edge" : /opr\/|opera/i.test(s) ? "opera" : /samsungbrowser/i.test(s) ? "samsung" : /firefox|fxios/i.test(s) ? "firefox" : /chrome|crios|chromium/i.test(s) ? "chrome" : /safari/i.test(s) ? "safari" : /dart|okhttp|outlly/i.test(s) ? "app" : "other";
  return `${browser}/${os}`;
}

/** The first-party device id from the cookie middleware sets. Anything that isn't a UUID is ignored. */
export function deviceIdFromRequest(req: Pick<NextRequest, "cookies">): string | null {
  const v = req.cookies.get(DEVICE_COOKIE)?.value?.trim() ?? "";
  return DEVICE_ID.test(v) ? v.toLowerCase() : null;
}

const countryOf = (req: Pick<NextRequest, "headers">) => {
  const c = (req.headers.get("x-vercel-ip-country") ?? req.headers.get("cf-ipcountry") ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
};

export function signalHashes(req: NextRequest) {
  const ip = clientIp(req);
  const device = deviceIdFromRequest(req);
  return {
    ipHash: signalHash("ip", ip),
    netHash: signalHash("net", networkPrefix(ip)),
    deviceHash: device ? signalHash("device", device) : null,
    uaHash: signalHash("ua", uaFamily(req.headers.get("user-agent"))),
    country: countryOf(req),
    deviceId: device,
  };
}

/** Records one signal. Best effort for callers: wrap in .catch so a failed write never blocks signup or checkout. */
export async function captureSignal(o: { req: NextRequest; userId: string | null; event: SignalEvent }) {
  const { deviceId, ...h } = signalHashes(o.req);
  const row = await db.signupSignal.create({ data: { userId: o.userId, event: o.event, ...h } });
  return { ...row, deviceId };
}

export async function pruneSignals(now = new Date()) {
  const r = await db.signupSignal.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - SIGNAL_KEEP_DAYS * 864e5) } } });
  return r.count;
}
