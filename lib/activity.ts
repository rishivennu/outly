import "server-only";
import { db } from "./db";

const g = globalThis as unknown as { __seen?: Map<string, string> };
const seen = (g.__seen ??= new Map());

/** Marks the user active today. At most one write per user per day per process. Never throws. */
export async function touchActivity(userId: string) {
  const day = new Date().toISOString().slice(0, 10);
  if (seen.get(userId) === day) return;
  seen.set(userId, day);
  try {
    await db.userActivityDay.upsert({ where: { userId_day: { userId, day } }, create: { userId, day }, update: {} });
    await db.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } });
  } catch {
    seen.delete(userId);
  }
}
