import { json, route } from "@/lib/http";
import { resolveClient } from "@/lib/intelligence/client-scope";
import { intelligenceAccess } from "@/lib/intelligence/entitlements";
import { notEntitledView } from "@/lib/intelligence/entitlements-core";
import { predictionsOverview } from "@/lib/intelligence/model/predict";
import { personalRead } from "@/lib/intelligence/personal-reco";
import { getProfiles, personalStatus } from "@/lib/intelligence/profile";

export const dynamic = "force-dynamic";

/**
 * R1320: the personal layer in one read, for Pip, the home pulse and the app: the honesty-ladder status, the
 * per-platform profiles, the baselines with their accuracy, and the personal recommendations (read-only here: this
 * read stores nothing, so a dashboard that polls it never creates rows; /api/intelligence/recommendations does).
 * R1334: without the Personal Intelligence perk the read answers `{ entitled: false, upgrade }` and nothing else, so a
 * card can show the door instead of a fake locked number; every field a client reads is still present (empty).
 */
export const GET = route(
  async (req, { user }) => {
    const access = await intelligenceAccess(user.id);
    if (!access.enabled) return json({ ...notEntitledView(access), status: null, profiles: [], predictions: null, personal: null }, { headers: { "cache-control": "private, no-store" } });
    const { scopeKey, targetIds } = await resolveClient(user, req.nextUrl.searchParams.get("client"));
    const [status, profiles, predictions, personal] = await Promise.all([
      personalStatus(user.id, scopeKey),
      getProfiles(user.id, scopeKey),
      predictionsOverview(user.id, { scopeKey, targetIds }),
      personalRead(user.id, { scopeKey, targetIds, readOnly: true }),
    ]);
    return json({ entitled: true, status, profiles, predictions, personal }, { headers: { "cache-control": "private, no-store" } });
  },
  { limit: [60, 60_000] },
);
