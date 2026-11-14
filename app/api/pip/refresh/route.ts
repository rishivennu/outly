import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { limitShared } from "@/lib/rate-limit";
import { refreshData } from "@/lib/analytics/refresh";
import { safeTz } from "@/lib/pip/range";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({ platform: z.string().max(20).nullable().optional() });

/**
 * 1151: the Refresh Data button under Pip's analytics answers. Signed in only, scoped like every Pip tool (the
 * owner's workspace, narrowed to a teammate's accounts). Each refresh calls the platforms for real, so it is
 * limited per workspace to protect their quotas. The reply says per account what came back; `ok` is only true
 * when at least one account returned fresh data.
 */
export const POST = route(async (req, { user }) => {
  const b = Body.parse(await req.json().catch(() => ({})));
  if (!(await limitShared(`pip-refresh:${user.id}`, 4, 10 * 60_000)).ok)
    throw new HttpError(429, "You've refreshed a few times already. Give it a few minutes; the background sync keeps going meanwhile.", "RATE_LIMITED");
  const r = await refreshData({ ownerId: user.id, scope: user.scope, platform: b.platform ?? null, tz: safeTz(user.timezone) });
  return json(r, { headers: { "cache-control": "no-store" } });
}, { limit: [10, 60_000] });
