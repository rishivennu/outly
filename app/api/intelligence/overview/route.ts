import { HttpError, json, route } from "@/lib/http";
import { analyticsScope } from "@/lib/profiles";
import { isObjective } from "@/lib/intelligence/core";
import { accountIdsForClient, getBrandProfile } from "@/lib/intelligence/memory";
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
    // R1243: ?client= reads an agency client's brand profile for its objective. R1246: a client with accounts also
    // narrows the numbers to those accounts; one with none keeps the workspace's numbers and says so (clientAccounts 0).
    const client = q.get("client");
    let clientObjective: string | undefined;
    let clientIds: string[] | null = null;
    if (client) {
      if (user.role !== "owner") throw new HttpError(403, "Only the workspace owner can switch clients.", "OWNER_ONLY");
      if (client.length > CLIENT_KEY_MAX) throw new HttpError(400, "That client key is too long.", "BAD_CLIENT");
      const profile = await getBrandProfile(user.id, client);
      if (!profile) throw new HttpError(404, "That client profile no longer exists.", "NO_CLIENT");
      clientObjective = profile.objective;
      clientIds = (await accountIdsForClient(user.id, client)) ?? [];
    }
    const scoped = await analyticsScope(user, q.get("account"));
    // Picking an account the client does not own leaves nothing, and the dashboard shows that as an empty read.
    const own = clientIds?.length ? new Set(clientIds) : null;
    const accountIds = own ? (scoped ? scoped.filter((id) => own.has(id)) : [...own]) : scoped;
    // R1249: a client read stores and reads its recommendations under the client's scopeKey, never the workspace's "".
    const data = await overview(user, { days, objective: objective ?? clientObjective, accountIds, scopeKey: client ?? "" });
    const body = clientIds ? { ...data, clientAccounts: clientIds.length } : data;
    return json(body, { headers: { "cache-control": "private, no-store" } });
  },
  { limit: [60, 60_000] },
);
