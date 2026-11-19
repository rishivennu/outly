import { HttpError, json, route } from "@/lib/http";
import { analyticsScope } from "@/lib/profiles";
import { isObjective } from "@/lib/intelligence/core";
import { getBrandProfile } from "@/lib/intelligence/memory";
import { overview } from "@/lib/intelligence/service";
import { CLIENT_KEY_MAX } from "@/components/intelligence/view-core";

export const dynamic = "force-dynamic";

/** The windows the dashboard offers. Anything else is a typed URL, not a choice the app can make. */
const DAYS = [7, 28, 90];

/**
 * R1236: the Content Intelligence read model. ?days= picks the window (28 by default) and ?objective= judges this
 * read against another objective without saving it. Member scope is respected through analyticsScope, so a member
 * only ever sees the accounts they may work on.
 */
export const GET = route(
  async (req, { user }) => {
    const q = req.nextUrl.searchParams;
    const raw = q.get("days");
    const days = raw === null ? 28 : Number(raw);
    if (!DAYS.includes(days)) throw new HttpError(400, `Pick a window of ${DAYS.join(", ")} days.`, "BAD_DAYS");
    const objective = q.get("objective");
    if (objective !== null && !isObjective(objective)) throw new HttpError(400, "Choose an objective: awareness, engagement, community, traffic, leads or sales.", "BAD_OBJECTIVE");
    // R1243: ?client= reads an agency client's brand profile for its objective. It never filters the numbers: no
    // client is mapped to accounts or posts yet (see CLIENT_NOTE in components/intelligence/view-core.ts).
    const client = q.get("client");
    let clientObjective: string | undefined;
    if (client) {
      if (user.role !== "owner") throw new HttpError(403, "Only the workspace owner can switch clients.", "OWNER_ONLY");
      if (client.length > CLIENT_KEY_MAX) throw new HttpError(400, "That client key is too long.", "BAD_CLIENT");
      const profile = await getBrandProfile(user.id, client);
      if (!profile) throw new HttpError(404, "That client profile no longer exists.", "NO_CLIENT");
      clientObjective = profile.objective;
    }
    const accountIds = await analyticsScope(user, q.get("account"));
    const data = await overview(user, { days, objective: objective ?? clientObjective, accountIds });
    return json(data, { headers: { "cache-control": "private, no-store" } });
  },
  { limit: [60, 60_000] },
);
