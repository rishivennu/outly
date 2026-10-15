import "server-only";
import { db } from "../db";
import { PLATFORMS, type Platform } from "../domain";

/** What Pip can act on for a signed-in creator: failed posts, broken connections, tokens about to lapse. */
export type ChatContextItem =
  | { kind: "failed"; id: string; platform: Platform; title: string; targetId: string; reconnect: boolean }
  | { kind: "reconnect"; id: string; platform: Platform }
  | { kind: "expiring"; id: string; platform: Platform; days: number };

const isPlatform = (p: string): p is Platform => (PLATFORMS as readonly string[]).includes(p);
const DAY = 864e5;

export async function chatContext(userId: string, now = new Date()): Promise<ChatContextItem[]> {
  const [failed, accounts] = await Promise.all([
    db.postTarget.findMany({
      where: { platformStatus: "failed", practice: false, post: { userId }, updatedAt: { gte: new Date(now.getTime() - 14 * DAY) } },
      select: { id: true, platform: true, errorCode: true, post: { select: { title: true, hook: true } } },
      orderBy: { updatedAt: "desc" },
      take: 3,
    }),
    db.socialAccount.findMany({ where: { userId, status: { in: ["connected", "needs_reconnect"] } }, select: { id: true, platform: true, status: true, tokenExpiresAt: true, refreshToken: true } }),
  ]);
  const out: ChatContextItem[] = [];
  const broken = new Set<string>();
  for (const a of accounts) {
    if (!isPlatform(a.platform)) continue;
    if (a.status === "needs_reconnect") {
      broken.add(a.platform);
      out.push({ kind: "reconnect", id: `r-${a.id}`, platform: a.platform });
    } else if (a.tokenExpiresAt && !a.refreshToken) {
      // Tokens with a refresh token renew themselves; only the ones that can't are worth a warning.
      const days = Math.ceil((a.tokenExpiresAt.getTime() - now.getTime()) / DAY);
      if (days >= 0 && days <= 7) out.push({ kind: "expiring", id: `e-${a.id}`, platform: a.platform, days: Math.max(1, days) });
    }
  }
  for (const t of failed) {
    if (!isPlatform(t.platform)) continue;
    const title = (t.post.title || t.post.hook || "Your post").split("\n")[0].slice(0, 60);
    out.unshift({ kind: "failed", id: `f-${t.id}`, platform: t.platform, title, targetId: t.id, reconnect: broken.has(t.platform) || t.errorCode === "AUTH_EXPIRED" || t.errorCode === "NOT_CONNECTED" });
  }
  return out.slice(0, 4);
}
