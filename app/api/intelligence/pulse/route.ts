import { json, route } from "@/lib/http";
import { resolveClient, targetIdsForAccounts } from "@/lib/intelligence/client-scope";
import { LEVEL_LABEL } from "@/lib/intelligence/profile-core";
import { intelligencePulse } from "@/lib/intelligence/pulse";
import { pulseLines } from "@/lib/intelligence/pulse-core";

export const dynamic = "force-dynamic";

/**
 * R1326: GET /api/intelligence/pulse: the one-glance digest Home shows (per-platform baseline with its sample and
 * level word, one open recommendation, the clipper queue counts), in one read for the app. `null` pulse when nothing
 * is measured and no clipper job exists. `lines` are the same sentences Pip and the Monday email use, so a client
 * never has to compose a number's caption itself. ?client= narrows to a client profile (owner only). A scoped
 * teammate reads only their accounts' destinations, the same subset Pip gives them (R1328 review); the clipper queue,
 * which has no per-account view, is left out of a scoped pulse.
 */
export const GET = route(
  async (req, { user }) => {
    const { scopeKey, targetIds } = user.scope
      ? { scopeKey: `pip:${user.scope.slice().sort().join(",")}`, targetIds: await targetIdsForAccounts(user.id, user.scope) }
      : await resolveClient(user, req.nextUrl.searchParams.get("client"));
    const pulse = await intelligencePulse(user.id, { scopeKey, targetIds });
    return json(
      pulse ? { pulse: { ...pulse, platforms: pulse.platforms.map((p) => ({ ...p, label: LEVEL_LABEL[p.level] })) }, lines: pulseLines(pulse) } : { pulse: null, lines: [] },
      { headers: { "cache-control": "private, no-store" } },
    );
  },
  { limit: [60, 60_000] },
);
