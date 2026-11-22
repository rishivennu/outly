import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "../db";
import { PUSH_COOKIE, WEBPUSH_COOKIE } from "./device";
import { allowedEndpoint, b64u } from "./webpush-core";

/** Most devices one person keeps. The one unused longest makes room for a new one. */
export const MAX_DEVICES = 10;

/** PushSubscription.toJSON() as the browser sends it. Only real push services, real key sizes. */
export const SubSchema = z.object({
  endpoint: z.string().max(1024).refine(allowedEndpoint, "That isn't a push service this app supports."),
  keys: z.object({
    p256dh: z.string().max(200).refine((k) => b64u.dec(k).length === 65, "Bad key"),
    auth: z.string().max(64).refine((k) => b64u.dec(k).length >= 16, "Bad key"),
  }),
});

/**
 * The connected devices, last active first. `current` = the browser (or the phone) asking. R-APP6: the Android
 * app's FCM phones (PushDevice) are listed beside the Web Push browsers, so Settings > Notifications shows
 * every device that gets alerts and "Send test" / "Remove" can reach them too.
 */
export async function devicesOf(userId: string) {
  const jar = await cookies();
  const mine = jar.get(WEBPUSH_COOKIE)?.value;
  const myPhone = jar.get(PUSH_COOKIE)?.value;
  const [rows, phones] = await Promise.all([
    db.webPushSub.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" }, take: 20, select: { id: true, platform: true, device: true, client: true, installed: true, failures: true, createdAt: true, lastSeenAt: true, lastPushAt: true } }),
    db.pushDevice.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" }, take: 10, select: { id: true, platform: true, createdAt: true, lastSeenAt: true } }),
  ]);
  const web = rows.map((r) => ({
    id: r.id,
    device: r.device,
    platform: r.platform,
    client: r.client,
    installed: r.installed,
    status: r.failures > 0 ? ("trouble" as const) : ("active" as const),
    addedAt: r.createdAt.toISOString(),
    lastActiveAt: r.lastSeenAt.toISOString(),
    lastPushAt: r.lastPushAt?.toISOString() ?? null,
    current: r.id === mine,
  }));
  const app = phones.map((p) => ({
    id: p.id,
    device: p.platform === "android" ? "Android phone" : "Phone",
    platform: p.platform,
    client: "Outlly app",
    installed: true,
    status: "active" as const,
    addedAt: p.createdAt.toISOString(),
    lastActiveAt: p.lastSeenAt.toISOString(),
    lastPushAt: null as string | null,
    current: p.id === myPhone,
  }));
  return [...web, ...app].sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : a.lastActiveAt > b.lastActiveAt ? -1 : 0));
}
