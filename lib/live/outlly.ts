import "server-only";
import type { SocialAccount } from "@prisma/client";
import { db } from "../db";
import { PLATFORM_META, type Platform } from "../domain";
import type { LivePost, PlatformDashboard } from "./types";

/**
 * Platforms without a live-numbers reader yet (Threads, LinkedIn, TikTok). Their tokens only work on their
 * own API, so calling anyone else's (X, before 10-26) answered 401 and the page said "connection expired".
 * Show what Outlly knows for sure instead: the posts sent through it, with links, and say plainly why
 * there are no platform numbers.
 */
export async function outllyDashboard(userId: string, platform: Platform, acct: SocialAccount, rangeDays = 28): Promise<Omit<PlatformDashboard, "suggestions">> {
  const name = PLATFORM_META[platform].name;
  const rows = await db.postTarget.findMany({
    where: { post: { userId }, platform, practice: false, platformStatus: "published", publishedAt: { not: null }, OR: [{ removeMode: null }, { removeMode: { not: "deleted" } }] },
    include: { post: { select: { title: true, hook: true } } },
    orderBy: { publishedAt: "desc" },
    take: 24,
  });
  const posts: LivePost[] = rows.map((t) => {
    const text = [t.caption, t.description].find((x) => x?.trim()) ?? "";
    return {
      id: t.id,
      title: (t.title || t.post.title || t.post.hook?.split("\n")[0] || text.split("\n")[0] || "Untitled").slice(0, 120),
      thumb: null,
      url: t.platformUrl,
      publishedAt: t.publishedAt!.toISOString(),
      format: `${PLATFORM_META[platform].format}s`,
      views: null,
      likes: null,
      comments: null,
      captionLength: text.length,
      hashtags: (t.hashtags?.match(/#[\p{L}\p{N}_]+/gu) ?? []).length,
    };
  });
  const since = Date.now() - rangeDays * 864e5;
  return {
    platform,
    status: "ok",
    fetchedAt: new Date().toISOString(),
    rangeDays,
    profile: { name: acct.displayName || acct.username, handle: acct.username, avatar: acct.avatar ?? null, url: null },
    headline: [
      { key: "sent", label: "Sent from Outlly", value: posts.length },
      { key: "recent", label: `Last ${rangeDays} days`, value: posts.filter((x) => new Date(x.publishedAt).getTime() >= since).length },
    ],
    series: [],
    posts,
    notes: [{ level: "info", text: `You're connected. ${name} doesn't share views and likes with Outlly yet, so this page lists what you've sent from here. Open a post to see its numbers on ${name}.` }],
  };
}
