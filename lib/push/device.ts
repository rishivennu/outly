import "server-only";
import { cookies } from "next/headers";
import { db } from "../db";

/** Which PushDevice this app install is, so signing out stops its notifications. */
export const PUSH_COOKIE = "ol_push";

/** 1118: which WebPushSub this browser is (Settings > Notifications), for the same reason. */
export const WEBPUSH_COOKIE = "ol_wp";

export async function forgetThisDevice() {
  const jar = await cookies();
  const id = jar.get(PUSH_COOKIE)?.value;
  if (id) await db.pushDevice.deleteMany({ where: { id } }).catch(() => {});
  jar.delete(PUSH_COOKIE);
  // Signed out on this browser: its notifications stop too (they would show someone else's account otherwise).
  const wp = jar.get(WEBPUSH_COOKIE)?.value;
  if (wp) await db.webPushSub.deleteMany({ where: { id: wp } }).catch(() => {});
  jar.delete(WEBPUSH_COOKIE);
}

export async function forgetAllDevices(userId: string) {
  await db.pushDevice.deleteMany({ where: { userId } }).catch(() => {});
  await db.webPushSub.deleteMany({ where: { userId } }).catch(() => {});
  const jar = await cookies();
  jar.delete(PUSH_COOKIE);
  jar.delete(WEBPUSH_COOKIE);
}
