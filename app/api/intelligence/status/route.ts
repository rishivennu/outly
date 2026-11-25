import { json, route } from "@/lib/http";
import { resolveClient } from "@/lib/intelligence/client-scope";
import { personalStatus } from "@/lib/intelligence/profile";
import { BLENDED_MIN, LEVEL_LABEL, PERSONAL_MIN, PROFILE_WINDOW_DAYS } from "@/lib/intelligence/profile-core";
import { requireIntelligence } from "@/lib/intelligence/entitlements";
import { kickBackfill } from "@/lib/intelligence/backfill";

export const dynamic = "force-dynamic";

/**
 * R1318: GET /api/intelligence/status: personalization level per platform, how many posts are measured, when the engine last ran.
 * R1338: on the workspace scope the read also reports `coldStart` (no workspace profile yet) and `backfill` (what this read did
 * about a missing or stale profile: kicked | fresh | locked | not-entitled | no-posts), so a freshly upgraded creator gets
 * their first profile within the minute instead of waiting for the sweep.
 */
export const GET = route(
  async (req, { user }) => {
    await requireIntelligence(user.id, "personal_intelligence_enabled");
    const { scopeKey: client } = await resolveClient(user, req.nextUrl.searchParams.get("client"));
    const [status, kick] = await Promise.all([personalStatus(user.id, client), client ? null : kickBackfill(user.id).catch(() => null)]);
    return json(
      { ...status, levels: status.levels.map((l) => ({ ...l, label: LEVEL_LABEL[l.level] })), thresholds: { personal: PERSONAL_MIN, blended: BLENDED_MIN, windowDays: PROFILE_WINDOW_DAYS }, coldStart: kick ? kick.coldStart : status.levels.length === 0, backfill: kick?.verdict ?? null },
      { headers: { "cache-control": "private, no-store" } },
    );
  },
  { limit: [60, 60_000] },
);
