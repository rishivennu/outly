import { adminRoute } from "@/lib/admin/route";
import { toCsv } from "@/lib/costs/core";
import { exportRows } from "@/lib/costs/overview";
import { costsPdf, costsWorkbook, exportName, parseRange } from "@/lib/costs/report";

export const dynamic = "force-dynamic";

/**
 * R1314: CSV of the ledger (kind=events) or the daily rollup (kind=daily) for a date range. Opens in Excel as-is.
 * R1333: format=xlsx is one workbook (Summary, Daily, Ledger); format=pdf is the report (KPIs, breakdowns, budgets,
 * recommendations, open alerts).
 */
export const GET = adminRoute("costs", async (req) => {
  const sp = req.nextUrl.searchParams;
  const range = parseRange(sp);
  if (!range.ok) return Response.json({ error: range.error }, { status: 400 });
  const { from, to } = range;
  const format = sp.get("format") === "xlsx" ? "xlsx" : sp.get("format") === "pdf" ? "pdf" : "csv";
  const headers = (type: string, name: string) => ({ "content-type": type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" });
  if (format === "xlsx") {
    const { bytes, range } = await costsWorkbook(from, to);
    return new Response(bytes, { headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", exportName("workbook", range.from, range.to, "xlsx")) });
  }
  if (format === "pdf") {
    const { bytes, range } = await costsPdf(from, to);
    return new Response(bytes, { headers: headers("application/pdf", exportName("report", range.from, range.to, "pdf")) });
  }
  const kind = sp.get("kind") === "daily" ? "daily" : "events";
  const { head, rows } = await exportRows(kind, from, to);
  return new Response(toCsv(head, rows), { headers: headers("text/csv; charset=utf-8", exportName(kind, from, to, "csv")) });
}, [20, 60_000]);
