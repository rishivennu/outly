import { json, route } from "@/lib/http";
import { refreshOwner } from "@/lib/intelligence/profile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * R1318: POST /api/intelligence/refresh: recompute this workspace's features and profiles now instead of waiting for
 * the sweep. Bounded (200 destinations a call) and rate limited to 2 a minute per user; members refresh the owner's
 * workspace, which is the only scope the engine knows.
 */
export const POST = route(
  async (_req, { user }) => {
    // user.id is the workspace owner for members too (lib/auth.ts seats a member on the owner's row).
    const r = await refreshOwner(user.id, { batch: 200 });
    return json({ ok: true, features: r.features, profiles: r.profiles, clients: r.clients });
  },
  { limit: [2, 60_000] },
);
