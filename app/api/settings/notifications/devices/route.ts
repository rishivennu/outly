import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { encrypt } from "@/lib/crypto";
import { HttpError, json, route } from "@/lib/http";
import { vapidKeys } from "@/lib/push/vapid";
import { endpointHash } from "@/lib/push/webpush";
import { describeDevice } from "@/lib/push/device-core";
import { WEBPUSH_COOKIE } from "@/lib/push/device";
import { MAX_DEVICES, SubSchema as Sub, devicesOf } from "@/lib/push/web-devices";

export const dynamic = "force-dynamic";

const Body = z.object({ sub: Sub, installed: z.boolean().default(false), touchMac: z.boolean().default(false), key: z.string().max(200) });

/**
 * This browser turned notifications on (or opened Outlly again with them on: same call, it refreshes
 * "last active"). Endpoint and keys are stored encrypted; the hash finds the row again.
 */
export const POST = route(
  async (req, { user }) => {
    const b = Body.parse(await req.json());
    const v = await vapidKeys();
    // Subscribed with an old key: the browser has to subscribe again, so tell it which key is current.
    if (b.key.replace(/=+$/, "") !== v.publicKey) throw new HttpError(409, "Notifications need to be turned on again on this device.", "vapid_changed", { publicKey: v.publicKey });
    const info = describeDevice(req.headers.get("user-agent") ?? "", { installed: b.installed, touchMac: b.touchMac });
    const hash = endpointHash(b.sub.endpoint);
    const data = { userId: user.id, endpoint: encrypt(b.sub.endpoint), p256dh: encrypt(b.sub.keys.p256dh), auth: encrypt(b.sub.keys.auth), vapidKey: v.publicKey, ...info, installed: b.installed || info.platform === "ios", lastSeenAt: new Date() };
    // A subscription moves with the browser: whoever is signed in on it now gets its notifications.
    const row = await db.webPushSub.upsert({ where: { endpointHash: hash }, create: { endpointHash: hash, ...data }, update: { ...data, failures: 0 } });
    const extra = await db.webPushSub.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: "desc" }, skip: MAX_DEVICES, select: { id: true } });
    if (extra.length) await db.webPushSub.deleteMany({ where: { id: { in: extra.map((x) => x.id) } } });
    (await cookies()).set(WEBPUSH_COOKIE, row.id, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 400 });
    return json({ id: row.id, devices: await devicesOf(user.id) });
  },
  { limit: [20, 60_000] },
);

const Del = z.union([z.object({ id: z.string().min(10).max(40) }), z.object({ endpoint: z.string().max(1024) }), z.object({ all: z.literal(true) })]);

/** Remove a device (from the list, or "turn off on this device"). Only ever the caller's own. */
export const DELETE = route(
  async (req, { user }) => {
    const b = Del.parse(await req.json());
    const where = "id" in b ? { id: b.id, userId: user.id } : "endpoint" in b ? { endpointHash: endpointHash(b.endpoint), userId: user.id } : { userId: user.id };
    const r = await db.webPushSub.deleteMany({ where });
    const jar = await cookies();
    const mine = jar.get(WEBPUSH_COOKIE)?.value;
    if (mine && !(await db.webPushSub.findUnique({ where: { id: mine }, select: { id: true } }))) jar.delete(WEBPUSH_COOKIE);
    return json({ removed: r.count, devices: await devicesOf(user.id) });
  },
  { limit: [30, 60_000] },
);
