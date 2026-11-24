import { json, route } from "@/lib/http";
import { resolveClient } from "@/lib/intelligence/client-scope";
import { predictionsOverview } from "@/lib/intelligence/model/predict";
import { personalRead } from "@/lib/intelligence/personal-reco";
import { getProfiles, personalStatus } from "@/lib/intelligence/profile";

export const dynamic = "force-dynamic";

/**
 * R1320: the personal layer in one read, for Pip, the home pulse and the app: the honesty-ladder status, the
 * per-platform profiles, the baselines with their accuracy, and the personal recommendations (read-only here: this
 * read stores nothing, so a dashboard that polls it never creates rows; /api/intelligence/recommendations does).
 */
export const GET = route(
  async (req, { user }) => {
    const { scopeKey, targetIds } = await resolveClient(user, req.nextUrl.searchParams.get("client"));
    const [status, profiles, predictions, personal] = await Promise.all([
      personalStatus(user.id, scopeKey),
      getProfiles(user.id, scopeKey),
      predictionsOverview(user.id, { scopeKey, targetIds }),
      personalRead(user.id, { scopeKey, targetIds, readOnly: true }),
    ]);
    return json({ status, profiles, predictions, personal }, { headers: { "cache-control": "private, no-store" } });
  },
  { limit: [60, 60_000] },
);
