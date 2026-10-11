import "server-only";
import { db } from "../db";
import type { Platform } from "../domain";
import { isPracticeAccount } from "../social/registry";

/** Which platforms have a real, working connection, for the tab dots. */
export async function connectedPlatforms(userId: string): Promise<Partial<Record<Platform, boolean>>> {
  const rows = await db.socialAccount.findMany({ where: { userId, status: "connected" }, select: { platform: true, platformUserId: true } });
  return Object.fromEntries(rows.filter((r) => !isPracticeAccount(r)).map((r) => [r.platform, true]));
}
