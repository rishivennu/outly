import { json, route } from "@/lib/http";
import { getBrandProfile, upsertBrandProfile } from "@/lib/intelligence/memory";
import { BRAND_LIMITS, brandProfileSchema, objectiveOptions } from "@/lib/intelligence/brand-core";

// R1235: the workspace brand profile (scope ""). Owner-only through OWNER_ONLY ("/api/settings") in lib/team/roles.ts.
export const GET = route(async (_req, { user }) => {
  const profile = await getBrandProfile(user.id, "");
  return json({ profile, objectives: objectiveOptions(), limits: BRAND_LIMITS });
});

export const POST = route(async (req, { user }) => {
  const body = brandProfileSchema.parse(await req.json());
  const profile = await upsertBrandProfile(user.id, "", body);
  return json({ profile });
}, { limit: [30, 60_000] });
