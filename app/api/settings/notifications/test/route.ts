import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { webPushToUser } from "@/lib/push/webpush";
import { pushToUser } from "@/lib/push/fcm";
import { unreadCount } from "@/lib/notify";

export const dynamic = "force-dynamic";

const Body = z.object({ id: z.string().min(10).max(40).optional() });

/**
 * "Send test notification": a real push through the same path every alert takes, to every device or one.
 * The answer says what each push service did, so "nothing arrived" can be told apart from "never sent".
 */
export const POST = route(
  async (req, { user }) => {
    const { id } = Body.parse(await req.json().catch(() => ({})));
    // R-APP6: a listed device is either a browser (WebPushSub) or the Android app (PushDevice, sent through FCM).
    const phone = id ? await db.pushDevice.findFirst({ where: { id, userId: user.id }, select: { id: true } }) : null;
    if (id && !phone && !(await db.webPushSub.findFirst({ where: { id, userId: user.id }, select: { id: true } }))) throw new HttpError(404, "That device isn't connected any more.", "no_device");
    const title = "Test notification";
    const body = "Notifications from Outlly reach this device. Tap to open your notification settings.";
    const href = "/settings/notifications";
    const r = phone ? { sent: 0, queued: 0, failed: 0, dropped: 0, devices: 0 } : await webPushToUser(user.id, { title, body, href, tag: `test:${Date.now()}`, kind: "test", badge: await unreadCount(user.id) }, { ttl: 300, urgency: "high", only: id });
    if (!id || phone) {
      const f = await pushToUser(user.id, { title, body, href }, { only: phone?.id });
      r.devices += f.devices;
      r.sent += f.sent;
      r.dropped += f.dropped;
      r.failed += Math.max(0, f.devices - f.sent - f.dropped);
    }
    if (!r.devices) throw new HttpError(409, "Turn on notifications on a device first.", "no_devices");
    return json(r);
  },
  { limit: [6, 60_000] },
);
