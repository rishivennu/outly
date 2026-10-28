import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { savedFromPosts } from "../marketing/time-saved";

export type SavedTime = { weekMin: number; totalMin: number; posts: number; weekPosts: number };

/**
 * Minutes Outlly saved one workspace (1038): every post that really went live (practice runs excluded),
 * counted once per platform it reached. `scope` is the 1037 account scope (a team seat's accounts, or the picked
 * profile), the same filter Home's drafts and next post use, so nobody sees minutes for accounts outside it.
 * The week counts only the platforms a post reached in the last 7 days (not its whole lifetime).
 */
export async function savedTime(userId: string, now = Date.now(), scope: Prisma.PostWhereInput = {}): Promise<SavedTime> {
  const base = { platformStatus: "published", practice: false, post: { userId, ...scope } } satisfies Prisma.PostTargetWhereInput;
  const since = new Date(now - 7 * 86_400_000);
  const [rows, week] = await Promise.all([
    db.postTarget.groupBy({ by: ["postId"], where: base, _count: { _all: true } }),
    db.postTarget.groupBy({ by: ["postId"], where: { ...base, publishedAt: { gte: since } }, _count: { _all: true } }),
  ]);
  return {
    weekMin: savedFromPosts(week.map((r) => r._count._all)),
    totalMin: savedFromPosts(rows.map((r) => r._count._all)),
    posts: rows.length,
    weekPosts: week.length,
  };
}
