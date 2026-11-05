import { HttpError, json, route } from "@/lib/http";
import { db } from "@/lib/db";
import { isPlatform } from "@/lib/domain";
import { platformDashboard } from "@/lib/live";
import { dashboardAccount, listProfiles } from "@/lib/profiles";
import { syncTimes, type SyncTimes } from "@/lib/analytics/sync";
import { activeDays, activeHours, formatBreakdown } from "@/lib/analytics/profile-core";

export const dynamic = "force-dynamic";

/**
 * 1140: one profile's dashboard. ?platform= is required; ?account= picks which account on that platform
 * (a manager can have several), and the list of switchable accounts comes back with it so the page can
 * switch without a full reload. Formats, active days and active hours are worked out from the posts the
 * platform already returned, so they cost no extra API call and show nothing the platform did not say.
 */
export const GET = route(
  async (req, { user }) => {
    const q = req.nextUrl.searchParams;
    const platform = q.get("platform") ?? "";
    if (!isPlatform(platform)) throw new HttpError(404, "We don't support that platform yet.");
    const profiles = (await listProfiles(user.id, user.scope)).filter((p) => p.platform === platform);
    const asked = q.get("account");
    // An id this person cannot see falls back to their own default, never to somebody else's account.
    const picked = (asked && profiles.find((p) => p.id === asked)?.id) || (await dashboardAccount(user, platform));
    const accountId = picked === "none" ? null : picked;
    const dash = await platformDashboard(user.id, platform, { accountId, fresh: q.get("fresh") === "1" });
    const tz = (await db.user.findUnique({ where: { id: user.id }, select: { timezone: true } }))?.timezone || "UTC";
    const posts = dash.status === "ok" ? dash.posts.map((p) => ({ format: p.format, publishedAt: p.publishedAt, views: p.views, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves })) : [];
    const times: SyncTimes = accountId ? await syncTimes([accountId]).catch((): SyncTimes => ({})) : {};
    return json(
      {
        ...dash,
        accountId,
        accounts: profiles.map((p) => ({ accountId: p.id, username: p.username, displayName: p.displayName, avatar: p.avatar, status: p.status, practice: p.mock })),
        formats: formatBreakdown(posts),
        days: activeDays(posts, tz),
        hoursPublished: activeHours(posts, tz),
        timezone: tz,
        lastSyncAt: (accountId && times[accountId]?.lastSyncAt) || null,
      },
      { headers: { "cache-control": "no-store" } },
    );
  },
  { limit: [40, 60_000] },
);
