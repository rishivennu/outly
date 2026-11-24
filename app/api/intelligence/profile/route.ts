import { HttpError, json, route } from "@/lib/http";
import { getBrandProfile } from "@/lib/intelligence/memory";
import { getProfiles } from "@/lib/intelligence/profile";
import { LEVEL_LABEL } from "@/lib/intelligence/profile-core";
import { CLIENT_KEY_MAX } from "@/components/intelligence/view-core";

export const dynamic = "force-dynamic";

/**
 * R1318: GET /api/intelligence/profile: the creator's derived profiles (workspace first, then one per platform with
 * posts). ?platform= returns one; ?client= (owner only) reads an agency client's scope. Profiles are rebuilt by the
 * sweep; an empty list means nothing has been computed yet (POST /api/intelligence/refresh asks for one now).
 */
export const GET = route(
  async (req, { user }) => {
    const q = req.nextUrl.searchParams;
    const client = q.get("client") ?? "";
    if (client) {
      if (user.role !== "owner") throw new HttpError(403, "Only the workspace owner can switch clients.", "OWNER_ONLY");
      if (client.length > CLIENT_KEY_MAX) throw new HttpError(400, "That client key is too long.", "BAD_CLIENT");
      if (!(await getBrandProfile(user.id, client))) throw new HttpError(404, "That client profile no longer exists.", "NO_CLIENT");
    }
    const platform = q.get("platform");
    const profiles = await getProfiles(user.id, client);
    const picked = platform === null ? profiles : profiles.filter((p) => p.platform === platform);
    if (platform !== null && !picked.length) throw new HttpError(404, "No profile for that platform yet.", "NO_PROFILE");
    return json({ profiles: picked.map((p) => ({ ...p, levelLabel: LEVEL_LABEL[p.level] })) }, { headers: { "cache-control": "private, no-store" } });
  },
  { limit: [60, 60_000] },
);
