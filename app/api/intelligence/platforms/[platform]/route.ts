import { HttpError, json, route } from "@/lib/http";
import { PLATFORMS } from "@/lib/domain";
import { resolveClient } from "@/lib/intelligence/client-scope";
import { getProfiles } from "@/lib/intelligence/profile";
import { LEVEL_LABEL } from "@/lib/intelligence/profile-core";
import { predictionsOverview } from "@/lib/intelligence/model/predict";
import { requireIntelligence } from "@/lib/intelligence/entitlements";

export const dynamic = "force-dynamic";

/** R1319: GET /api/intelligence/platforms/:platform: one platform's profile, baselines and accuracy in one read. */
export const GET = route(
  async (req, { user, params }) => {
    await requireIntelligence(user.id, "personal_intelligence_enabled");
    const platform = params.platform;
    if (!(PLATFORMS as readonly string[]).includes(platform)) throw new HttpError(400, "Unknown platform.", "BAD_PLATFORM");
    const { scopeKey, targetIds } = await resolveClient(user, req.nextUrl.searchParams.get("client"));
    const [profiles, predictions] = await Promise.all([getProfiles(user.id, scopeKey), predictionsOverview(user.id, { scopeKey, targetIds, platform })]);
    const profile = profiles.find((p) => p.platform === platform) ?? null;
    return json(
      { platform, profile: profile ? { ...profile, levelLabel: LEVEL_LABEL[profile.level] } : null, predictions: predictions.platforms[0] ?? null, recent: predictions.recent, model: predictions.model },
      { headers: { "cache-control": "private, no-store" } },
    );
  },
  { limit: [60, 60_000] },
);
