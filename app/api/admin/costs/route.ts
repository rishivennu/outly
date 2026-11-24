import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { aiBreakdown, overview, topUsers } from "@/lib/costs/overview";

export const dynamic = "force-dynamic";

/** R1314: the whole Infrastructure & Costs view as JSON (the page's refresh and the exports' source of truth). R1315: ?view=ai | users for the drilldowns. */
export const GET = adminRoute("costs", async (req) => {
  const sp = req.nextUrl.searchParams;
  const range = { from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined };
  const view = sp.get("view");
  if (view === "ai") return json(await aiBreakdown(range));
  if (view === "users") return json(await topUsers({ ...range, limit: Number(sp.get("limit")) || undefined }));
  return json(await overview(range));
});
