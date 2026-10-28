import { json, route } from "@/lib/http";
import { isDmPlatform } from "@/lib/messages/meta";
import { dmsOffList, listThreads, syncAll } from "@/lib/messages/service";
import { limitShared } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Direct message threads (1031). ?platform=instagram|facebook filters; ?sync=1 first pulls recent conversations from Meta. */
export const GET = route(
  async (req, { user }) => {
    const raw = req.nextUrl.searchParams.get("platform");
    const platform = raw && isDmPlatform(raw) ? raw : undefined;
    // A sync fans out to Meta for every account: far tighter than the list itself. Over it, serve what we have.
    const wantSync = req.nextUrl.searchParams.get("sync") === "1";
    const maySync = wantSync && (await limitShared(`dm-sync:${user.id}`, 6, 60_000)).ok;
    const problems = maySync ? await syncAll(user.id, platform, user.scope) : [];
    return json({ ...(await listThreads(user.id, platform, user.scope)), dmsOff: dmsOffList(), problems, ...(wantSync && !maySync ? { syncSkipped: true } : {}) });
  },
  { limit: [60, 60_000] },
);
