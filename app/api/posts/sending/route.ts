import { db } from "@/lib/db";
import { json, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The studio's sending pill (10-16g): your posts that are sending right now, plus any that settled in
 * the last 90 seconds so the pill can say how it ended. A post stuck "publishing" for over 6 hours is
 * left to the sweeper rather than shown forever. Small on purpose: platform and status only.
 */
export const GET = route(
  async (_req, { user }) => {
    const now = Date.now();
    const rows = await db.post.findMany({
      where: {
        userId: user.id,
        OR: [
          { status: "publishing", updatedAt: { gt: new Date(now - 6 * 3600_000) } },
          { status: { in: ["published", "partial", "failed"] }, updatedAt: { gt: new Date(now - 90_000) } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, title: true, hook: true, status: true, targets: { select: { platform: true, platformStatus: true, errorCode: true } } },
    });
    return json({
      posts: rows.map((p) => ({
        id: p.id,
        title: (p.title || p.hook || "Your post").split("\n")[0].slice(0, 60),
        status: p.status,
        targets: p.targets.map((t) => ({ platform: t.platform, status: t.platformStatus, errorCode: t.errorCode })),
      })),
    });
  },
  { limit: [240, 60_000] },
);
