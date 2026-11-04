import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "../db";
import { WEBPUSH_COOKIE } from "./device";
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

/** The connected devices, last active first. `current` = the browser asking. */
export async function devicesOf(userId: string) {
  const mine = (await cookies()).get(WEBPUSH_COOKIE)?.value;
  const rows = await db.webPushSub.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" }, take: 20, select: { id: true, platform: true, device: true, client: true, installed: true, failures: true, createdAt: true, lastSeenAt: true, lastPushAt: true } });
  return rows.map((r) => ({
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
}
