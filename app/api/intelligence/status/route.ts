import { json, route } from "@/lib/http";
import { resolveClient } from "@/lib/intelligence/client-scope";
import { personalStatus } from "@/lib/intelligence/profile";
import { BLENDED_MIN, LEVEL_LABEL, PERSONAL_MIN, PROFILE_WINDOW_DAYS } from "@/lib/intelligence/profile-core";

export const dynamic = "force-dynamic";

/** R1318: GET /api/intelligence/status: personalization level per platform, how many posts are measured, when the engine last ran. */
export const GET = route(
  async (req, { user }) => {
    const { scopeKey: client } = await resolveClient(user, req.nextUrl.searchParams.get("client"));
    const status = await personalStatus(user.id, client);
    return json(
      { ...status, levels: status.levels.map((l) => ({ ...l, label: LEVEL_LABEL[l.level] })), thresholds: { personal: PERSONAL_MIN, blended: BLENDED_MIN, windowDays: PROFILE_WINDOW_DAYS } },
      { headers: { "cache-control": "private, no-store" } },
    );
  },
  { limit: [60, 60_000] },
);
