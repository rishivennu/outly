import { json, route } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth";
import { pipInsights } from "@/lib/pip/tools-analytics";
import { safeTz } from "@/lib/pip/range";

export const dynamic = "force-dynamic";

/**
 * 1123: up to three evidence-backed nudges for Pip's studio panel (a slow week, a big post worth a look,
 * scheduled posts with no caption). Built from the signed-in person's own records, scoped like every Pip
 * tool: the owner's workspace, narrowed to a teammate's accounts. Visitors get an empty list.
 */
export const GET = route(
  async () => {
    const me = await getCurrentUser();
    if (!me) return json({ items: [] });
    const items = await pipInsights({
      ownerId: me.id,
      actorId: me.actor?.id ?? null,
      scope: me.scope,
      tz: safeTz(me.timezone),
      now: new Date(),
      message: "",
    }).catch(() => []);
    return json({ items }, { headers: { "cache-control": "no-store" } });
  },
  { auth: false, limit: [30, 60_000] },
);
