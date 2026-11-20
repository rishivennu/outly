import { json, route } from "@/lib/http";
import { listRecommendations } from "@/lib/intelligence/reco";
import { outcomesFor } from "@/lib/intelligence/outcome";
import { hasOutcomeLine, withOutcomes } from "@/components/intelligence/view-core";

export const dynamic = "force-dynamic";

/**
 * R1240: the workspace's recommendations, newest first. `status` filters, `scope` picks an agency client, `limit` <= 50.
 * R1248: accepted and done rows carry `outcome` (the latest early signal, or null while measuring), owner-scoped.
 */
export const GET = route(async (req, { user }) => {
  const q = req.nextUrl.searchParams;
  const status = q.get("status") || undefined;
  const limit = Math.min(50, Math.max(1, Number(q.get("limit")) || 20));
  const rows = await listRecommendations(user.id, (q.get("scope") ?? "").slice(0, 100), { status, limit });
  const outcomes = await outcomesFor(user.id, rows.filter((r) => hasOutcomeLine(r.status)).map((r) => r.id));
  return json({ recommendations: withOutcomes(rows, outcomes) });
});
