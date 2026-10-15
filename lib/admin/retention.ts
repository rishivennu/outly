import "server-only";
import { db } from "../db";
import { riskOf, winbackAllowed, type RiskFacts, type RiskReason } from "../retention/core";

const DAY = 864e5;

export const REASON_LABEL: Record<RiskReason, string> = {
  cancelling: "Cancelling at period end",
  paused: "Plan paused",
  quiet: "Gone quiet",
  slowing: "Posting half as much",
  broken: "Failed posts or a signed-out account",
  never_posted: "Never posted",
};

/** What a person on the team should do first, per strongest reason. */
export const REASON_ACTION: Record<RiskReason, string> = {
  cancelling: "Ask what's missing before the period ends",
  paused: "Check in before the pause ends",
  quiet: "Send a win-back email",
  slowing: "Suggest a weekly goal or recycling an old hit",
  broken: "Help them reconnect or retry",
  never_posted: "Offer help with the first post",
};

export interface RiskRow {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  plan: string | null;
  priceMinor: number;
  currency: string;
  lastPost: Date | null;
  lastActive: Date | null;
  winbackAt: Date | null;
  canWinback: boolean;
  facts: RiskFacts;
  score: number;
  level: "high" | "medium" | "low";
  reasons: RiskReason[];
}

const daysSince = (d: Date | null | undefined, now: Date) => (d ? Math.floor((now.getTime() - d.getTime()) / DAY) : null);

/**
 * Every creator scored for churn risk. A handful of grouped queries rather than one per user,
 * so the page stays fast with thousands of accounts.
 */
export async function atRisk(now = new Date(), cap = 3000): Promise<RiskRow[]> {
  const d7 = new Date(now.getTime() - 7 * DAY);
  const d30 = new Date(now.getTime() - 30 * DAY);
  const d60 = new Date(now.getTime() - 60 * DAY);
  const real = { practice: false, platformStatus: "published" } as const;

  const [users, lastPosts, recent, failed, broken] = await Promise.all([
    db.user.findMany({
      take: cap,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, email: true, avatar: true, createdAt: true, lastActiveAt: true, winbackAt: true,
        subscriptions: {
          where: { status: { in: ["active", "past_due"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { priceMinor: true, currency: true, cancelAtPeriodEnd: true, pausedUntil: true, plan: { select: { name: true } } },
        },
      },
    }),
    db.post.groupBy({ by: ["userId"], where: { targets: { some: real } }, _max: { publishedAt: true } }),
    db.postTarget.findMany({ where: { ...real, publishedAt: { gte: d60 } }, select: { postId: true, publishedAt: true, post: { select: { userId: true } } } }),
    db.postTarget.findMany({ where: { practice: false, platformStatus: "failed", updatedAt: { gte: d7 } }, select: { post: { select: { userId: true } } } }),
    db.socialAccount.groupBy({ by: ["userId"], where: { status: "needs_reconnect" }, _count: { _all: true } }),
  ]);

  const last = new Map(lastPosts.map((r) => [r.userId, r._max.publishedAt]));
  // One count per post, not per platform: a clip sent to three networks is one post.
  const first = new Map<string, { userId: string; at: Date }>();
  for (const t of recent) {
    if (!t.publishedAt) continue;
    const prev = first.get(t.postId);
    if (!prev || t.publishedAt < prev.at) first.set(t.postId, { userId: t.post.userId, at: t.publishedAt });
  }
  const win = new Map<string, { last30: number; prev30: number }>();
  for (const { userId, at } of first.values()) {
    const w = win.get(userId) ?? { last30: 0, prev30: 0 };
    if (at >= d30) w.last30++;
    else w.prev30++;
    win.set(userId, w);
  }
  const failedBy = new Map<string, number>();
  for (const f of failed) failedBy.set(f.post.userId, (failedBy.get(f.post.userId) ?? 0) + 1);
  const brokenBy = new Map(broken.map((b) => [b.userId, b._count._all]));

  return users
    .map((u) => {
      const s = u.subscriptions[0];
      const lastPost = last.get(u.id) ?? null;
      const w = win.get(u.id) ?? { last30: 0, prev30: 0 };
      const facts: RiskFacts = {
        paid: !!s && s.priceMinor > 0,
        cancelling: !!s?.cancelAtPeriodEnd,
        paused: !!s?.pausedUntil && s.pausedUntil > now,
        daysSincePost: daysSince(lastPost, now),
        // No activity row yet: count from signup, so a brand-new account isn't flagged as quiet.
        daysSinceActive: daysSince(u.lastActiveAt ?? u.createdAt, now),
        failed7d: failedBy.get(u.id) ?? 0,
        reconnect: brokenBy.get(u.id) ?? 0,
        postsLast30: w.last30,
        postsPrev30: w.prev30,
      };
      const r = riskOf(facts);
      return {
        id: u.id, name: u.name, email: u.email, avatar: u.avatar,
        plan: s ? s.plan.name : null, priceMinor: s?.priceMinor ?? 0, currency: s?.currency ?? "INR",
        lastPost, lastActive: u.lastActiveAt, winbackAt: u.winbackAt, canWinback: winbackAllowed(u.winbackAt, now),
        facts, ...r,
      };
    })
    .sort((a, b) => b.score - a.score || b.priceMinor - a.priceMinor);
}
