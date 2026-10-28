import { json, route } from "@/lib/http";
import { activeProfile, listProfiles } from "@/lib/profiles";

export const dynamic = "force-dynamic";

/** Profiles (connected accounts) this person may work on, and which one is picked (1037). */
export const GET = route(async (_req, { user }) => {
  const profiles = await listProfiles(user.id, user.scope);
  const active = await activeProfile(user, profiles);
  return json({ profiles, activeId: active?.id ?? null });
});
