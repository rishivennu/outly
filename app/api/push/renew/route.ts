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
    const oldHash = endpointHash(b.old);
    const newHash = endpointHash(b.sub.endpoint);
    const row = await db.webPushSub.findUnique({ where: { endpointHash: oldHash }, select: { id: true } });
    if (!row) return json({ ok: false }, { status: 404 });
    // Already moved (the browser fired the event twice): that is the same device, so say it worked.
    if (newHash === oldHash) return json({ ok: true });
    const taken = await db.webPushSub.findUnique({ where: { endpointHash: newHash }, select: { id: true } });
    // Some other row already holds the new endpoint. Never silently claim success: the caller is told so it
    // can register the subscription the normal way, with a session.
    if (taken && taken.id !== row.id) return json({ ok: false, error: "That endpoint belongs to another device already." }, { status: 409 });
    const v = await vapidKeys();
    await db.webPushSub.update({
      where: { id: row.id },
      data: { endpointHash: newHash, endpoint: encrypt(b.sub.endpoint), p256dh: encrypt(b.sub.keys.p256dh), auth: encrypt(b.sub.keys.auth), vapidKey: v.publicKey, failures: 0, lastSeenAt: new Date() },
    });
    return json({ ok: true });
  },
  { auth: false, limit: [10, 60_000] },
);
