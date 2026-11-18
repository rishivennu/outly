import { z } from "zod";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { HttpError, json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { vapidKeys } from "@/lib/push/vapid";
import { endpointHash } from "@/lib/push/webpush";
import { describeDevice } from "@/lib/push/device-core";
import { SubSchema as Sub } from "@/lib/push/web-devices";
import { adminDevices } from "@/lib/health/admin-push";

export const dynamic = "force-dynamic";

/** Alert devices per admin. A phone, a laptop browser, the installed app: five is plenty. */
const MAX_ADMIN_DEVICES = 5;

const Body = z.object({ sub: Sub, installed: z.boolean().default(false), touchMac: z.boolean().default(false), key: z.string().max(200) });

/**
 * R1195: this browser turned Watchdog alert pushes on for the signed-in admin (or opened System Health again
 * with them on: same call, refreshes "last seen"). Same VAPID key and encryption as member devices; a separate
 * table, so an admin's alert device is never dropped by member device cleanup and never receives member notices.
 */
export const POST = adminRoute(
  "health",
  async (req, { admin }) => {
    const b = Body.parse(await req.json());
    const v = await vapidKeys();
    if (b.key.replace(/=+$/, "") !== v.publicKey) throw new HttpError(409, "Alert pushes need to be turned on again on this device.", "vapid_changed", { publicKey: v.publicKey });
    const info = describeDevice(req.headers.get("user-agent") ?? "", { installed: b.installed, touchMac: b.touchMac });
    const hash = endpointHash(b.sub.endpoint);
    const data = { adminId: admin.id, endpoint: encrypt(b.sub.endpoint), p256dh: encrypt(b.sub.keys.p256dh), auth: encrypt(b.sub.keys.auth), vapidKey: v.publicKey, platform: info.platform, device: info.device, client: info.client, lastSeenAt: new Date() };
    // A subscription moves with the browser: whichever admin is signed in on it now gets the alerts.
    const row = await db.adminPushSub.upsert({ where: { endpointHash: hash }, create: { endpointHash: hash, ...data }, update: { ...data, failures: 0 } });
    const extra = await db.adminPushSub.findMany({ where: { adminId: admin.id }, orderBy: { lastSeenAt: "desc" }, skip: MAX_ADMIN_DEVICES, select: { id: true } });
    if (extra.length) await db.adminPushSub.deleteMany({ where: { id: { in: extra.map((x) => x.id) } } });
    return json({ id: row.id, devices: await adminDevices(admin.id) });
  },
  [20, 60_000],
);

export const GET = adminRoute("health", async (_req, { admin }) => json({ devices: await adminDevices(admin.id) }));

const Del = z.union([z.object({ id: z.string().min(10).max(40) }), z.object({ endpoint: z.string().max(1024) }), z.object({ all: z.literal(true) })]);

/** Remove an alert device. Only ever the caller's own. */
export const DELETE = adminRoute(
  "health",
  async (req, { admin }) => {
    const b = Del.parse(await req.json());
    const where = "id" in b ? { id: b.id, adminId: admin.id } : "endpoint" in b ? { endpointHash: endpointHash(b.endpoint), adminId: admin.id } : { adminId: admin.id };
    const r = await db.adminPushSub.deleteMany({ where });
    return json({ removed: r.count, devices: await adminDevices(admin.id) });
  },
  [30, 60_000],
);
