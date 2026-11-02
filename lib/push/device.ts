import "server-only";
import { cookies } from "next/headers";
import { db } from "../db";

/** Which PushDevice this app install is, so signing out stops its notifications. */
export const PUSH_COOKIE = "ol_push";

export async function forgetThisDevice() {
  const id = (await cookies()).get(PUSH_COOKIE)?.value;
  if (id) await db.pushDevice.deleteMany({ where: { id } }).catch(() => {});
  (await cookies()).delete(PUSH_COOKIE);
}

export async function forgetAllDevices(userId: string) {
  await db.pushDevice.deleteMany({ where: { userId } }).catch(() => {});
  (await cookies()).delete(PUSH_COOKIE);
}
