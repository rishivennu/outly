import { json, route } from "@/lib/http";
import { listBrandProfiles } from "@/lib/intelligence/memory";

export const dynamic = "force-dynamic";

/**
 * R1243: the owner's brand profiles (own brand plus agency clients) for the Content Intelligence client switcher.
 * Owner-only through OWNER_ONLY ("/api/settings") in lib/team/roles.ts, and listBrandProfiles filters by owner.
 */
export const GET = route(async (_req, { user }) => {
  const profiles = (await listBrandProfiles(user.id)).map((p) => ({ scopeKey: p.scopeKey, name: p.name, objective: p.objective }));
  return json({ profiles }, { headers: { "cache-control": "private, no-store" } });
});
