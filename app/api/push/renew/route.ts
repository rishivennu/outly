import { z } from "zod";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { json, route } from "@/lib/http";
import { vapidKeys } from "@/lib/push/vapid";
import { endpointHash } from "@/lib/push/webpush";
import { SubSchema as Sub } from "@/lib/push/web-devices";

export const dynamic = "force-dynamic";

/**
 * The browser replaced a push subscription by itself (pushsubscriptionchange in public/sw.js), perhaps while
 * Outlly wasn't open and the session had ended. Knowing the old endpoint proves it is the same device: it is
 * an unguessable URL only that browser and our database ever held. Moves the device to the new endpoint.
 */
const Body = z.object({ old: z.string().max(1024), sub: Sub });

export const POST = route(
  async (req) => {
    const b = Body.parse(await req.json());
    const row = await db.webPushSub.findUnique({ where: { endpointHash: endpointHash(b.old) }, select: { id: true } });
    if (!row) return json({ ok: false }, { status: 404 });
    const v = await vapidKeys();
    await db.webPushSub.update({
      where: { id: row.id },
      data: { endpointHash: endpointHash(b.sub.endpoint), endpoint: encrypt(b.sub.endpoint), p256dh: encrypt(b.sub.keys.p256dh), auth: encrypt(b.sub.keys.auth), vapidKey: v.publicKey, failures: 0, lastSeenAt: new Date() },
    }).catch(() => null);
    return json({ ok: true });
  },
  { auth: false, limit: [10, 60_000] },
);
