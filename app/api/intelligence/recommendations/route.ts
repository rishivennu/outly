import { json, route } from "@/lib/http";
import { resolveClient } from "@/lib/intelligence/client-scope";
import { personalRead } from "@/lib/intelligence/personal-reco";

export const dynamic = "force-dynamic";

/**
 * R1320: personal recommendations, from the creator's own traits and baselines, stored with ids so the planner can
 * act on them (/api/intelligence/feedback or /api/recommendations/:id). ?client= reads an agency client's
 * destinations under that client's scope (owner only). The reason says why the list is empty when it is.
 */
export const GET = route(
  async (req, { user }) => {
    const { scopeKey, targetIds } = await resolveClient(user, req.nextUrl.searchParams.get("client"));
    const data = await personalRead(user.id, { scopeKey, targetIds });
    return json(data, { headers: { "cache-control": "private, no-store" } });
  },
  { limit: [60, 60_000] },
);
