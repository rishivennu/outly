import { HttpError, json, route } from "@/lib/http";
import { getBrandProfile } from "@/lib/intelligence/memory";
import { personalStatus } from "@/lib/intelligence/profile";
import { BLENDED_MIN, LEVEL_LABEL, PERSONAL_MIN, PROFILE_WINDOW_DAYS } from "@/lib/intelligence/profile-core";
import { CLIENT_KEY_MAX } from "@/components/intelligence/view-core";

export const dynamic = "force-dynamic";

/** R1318: GET /api/intelligence/status: personalization level per platform, how many posts are measured, when the engine last ran. */
export const GET = route(
  async (req, { user }) => {
    const client = req.nextUrl.searchParams.get("client") ?? "";
    if (client) {
      if (user.role !== "owner") throw new HttpError(403, "Only the workspace owner can switch clients.", "OWNER_ONLY");
      if (client.length > CLIENT_KEY_MAX) throw new HttpError(400, "That client key is too long.", "BAD_CLIENT");
      if (!(await getBrandProfile(user.id, client))) throw new HttpError(404, "That client profile no longer exists.", "NO_CLIENT");
    }
    const status = await personalStatus(user.id, client);
    return json(
      { ...status, levels: status.levels.map((l) => ({ ...l, label: LEVEL_LABEL[l.level] })), thresholds: { personal: PERSONAL_MIN, blended: BLENDED_MIN, windowDays: PROFILE_WINDOW_DAYS } },
      { headers: { "cache-control": "private, no-store" } },
    );
  },
  { limit: [60, 60_000] },
);
