import { adminRoute } from "@/lib/admin/route";
import { toCsv, dayKey } from "@/lib/costs/core";
import { exportRows } from "@/lib/costs/overview";

export const dynamic = "force-dynamic";

/** R1314: CSV of the ledger (kind=events) or the daily rollup (kind=daily) for a date range. Opens in Excel as-is. */
export const GET = adminRoute("costs", async (req) => {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind") === "daily" ? "daily" : "events";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to") ?? "") ? sp.get("to")! : dayKey(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("from") ?? "") ? sp.get("from")! : dayKey(new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * 86400_000));
  const { head, rows } = await exportRows(kind, from, to);
  return new Response(toCsv(head, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="outlly-costs-${kind}-${from}-to-${to}.csv"`, "cache-control": "no-store" } });
}, [20, 60_000]);
