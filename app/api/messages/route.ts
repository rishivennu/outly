import { json, route } from "@/lib/http";
import { isDmPlatform } from "@/lib/messages/meta";
import { dmsOffList, isThreadListView, listThreads, syncAll } from "@/lib/messages/service";
import { limitShared } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Direct message threads (1031). ?platform=instagram|facebook filters; ?sync=1 first pulls recent conversations from Meta.
 * Phase 2 (1155): ?view=inbox|unread|archived, ?cursor= for the next page, ?take= to reload what is already shown.
 */
export const GET = route(
  async (req, { user }) => {
    const sp = req.nextUrl.searchParams;
    const raw = sp.get("platform");
    const platform = raw && isDmPlatform(raw) ? raw : undefined;
    const v = sp.get("view");
    const view = isThreadListView(v) ? v : "inbox";
    const cursor = sp.get("cursor");
    // A sync fans out to Meta for every account: far tighter than the list itself. Over it, serve what we have.
    // Older pages come from our copy only.
    const wantSync = sp.get("sync") === "1" && !cursor;
    const maySync = wantSync && (await limitShared(`dm-sync:${user.id}`, 6, 60_000)).ok;
    const problems = maySync ? await syncAll(user.id, platform, user.scope) : [];
    const list = await listThreads(user.id, platform, user.scope, { view, cursor, take: Number(sp.get("take")) || undefined });
    return json({ ...list, dmsOff: dmsOffList(), problems, ...(wantSync && !maySync ? { syncSkipped: true } : {}) });
  },
  { limit: [60, 60_000] },
);
