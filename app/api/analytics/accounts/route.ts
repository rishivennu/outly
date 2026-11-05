import { json, route } from "@/lib/http";
import { PLATFORMS, type Platform } from "@/lib/domain";
import { platformDashboard } from "@/lib/live";
import { listProfiles } from "@/lib/profiles";
import { syncTimes, type SyncTimes } from "@/lib/analytics/sync";
import type { AccountCard, PlatformSlot } from "@/lib/analytics/cards";

export const dynamic = "force-dynamic";

/**
 * 1140 "Your accounts right now": one card per connected account, not one per platform, so a creator with
 * two Instagram profiles sees both and can open either. Each card carries what that platform's API really
 * gives (its own headline tiles and trend) plus when Outlly last synced it. Platforms with no account at
 * all come back in `slots`, so the page can offer Connect without pretending they have numbers.
 *
 * ?account=<id> answers for one card; ?fresh=1 skips the 90 s dashboard cache (the Refresh button).
 */
export const GET = route(
  async (req, { user }) => {
    const q = req.nextUrl.searchParams;
    const only = q.get("account");
    const fresh = q.get("fresh") === "1";
    const profiles = await listProfiles(user.id, user.scope);
    const wanted = only ? profiles.filter((p) => p.id === only) : profiles;
    const times = await syncTimes(wanted.map((p) => p.id)).catch((): SyncTimes => ({}));
    const cards: AccountCard[] = await Promise.all(
      wanted.map(async (p) => {
        const d = await platformDashboard(user.id, p.platform, { accountId: p.id, fresh }).catch(() => null);
        return {
          accountId: p.id,
          platform: p.platform,
          username: p.username,
          displayName: p.displayName,
          avatar: p.avatar ?? d?.profile?.avatar ?? null,
          status: p.status,
          practice: p.mock,
          lastSyncAt: times[p.id]?.lastSyncAt ?? null,
          lastError: times[p.id]?.lastError ?? null,
          // Posts are dropped: the standouts section already lists content, and 24 thumbnails per account
          // would make this answer many times bigger than the numbers it is here for.
          dash: d ? { ...d, posts: [] } : null,
        };
      }),
    );
    // Platforms with nothing connected: asked for their connect options only, which costs no API call.
    const empty = only ? [] : PLATFORMS.filter((pl) => !profiles.some((p) => p.platform === pl));
    const slots: PlatformSlot[] = await Promise.all(
      empty.map(async (pl) => {
        const d = await platformDashboard(user.id, pl).catch(() => null);
        return { platform: pl, status: d?.status ?? "not_connected", message: d?.message ?? null, connect: d?.connect ?? null };
      }),
    );
    return json({ accounts: cards, slots, fetchedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  },
  { limit: [40, 60_000] },
);
