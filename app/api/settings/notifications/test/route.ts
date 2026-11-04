import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { webPushToUser } from "@/lib/push/webpush";
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
    if (id && !(await db.webPushSub.findFirst({ where: { id, userId: user.id }, select: { id: true } }))) throw new HttpError(404, "That device isn't connected any more.", "no_device");
    const r = await webPushToUser(
      user.id,
      { title: "Test notification", body: "Notifications from Outlly reach this device. Tap to open your notification settings.", href: "/settings/notifications", tag: `test:${Date.now()}`, kind: "test", badge: await unreadCount(user.id) },
      { ttl: 300, urgency: "high", only: id },
    );
    if (!r.devices) throw new HttpError(409, "Turn on notifications on a device first.", "no_devices");
    return json(r);
  },
  { limit: [6, 60_000] },
);
