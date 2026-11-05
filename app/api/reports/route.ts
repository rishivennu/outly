import { NextResponse } from "next/server";
import { route, HttpError } from "@/lib/http";
import { buildClientReport } from "@/lib/reports/client-report-server";
import { reportCsv, reportPdf } from "@/lib/reports/client-report";
import { buildRangeReport, reportStamp } from "@/lib/analytics/report";
import { resolveRange } from "@/lib/analytics/core";
import { assertPerk } from "@/lib/billing/entitlements";
import { analyticsWindow } from "@/lib/billing/plan-rules";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports?format=csv|pdf&days=30&account=<id>: a client-ready analytics file (1037).
 * 1140: &from=YYYY-MM-DD&to=YYYY-MM-DD exports a custom range instead, clamped to the plan's history, so
 * the file covers exactly the window chosen on the analytics page.
 */
export const GET = route(async (req, { user }) => {
  const q = req.nextUrl.searchParams;
  const format = q.get("format") ?? "pdf";
  if (format !== "csv" && format !== "pdf") throw new HttpError(400, "Pick csv or pdf.", "BAD_FORMAT");
  // 1096: CSV export and client PDFs are plan perks, and a report reads no further back than the plan's history.
  const e = await assertPerk(user.id, format === "csv" ? "csv-export" : "client-reports");
  const w = analyticsWindow(e, Number(q.get("days") ?? 30));
  const days = w.days;
  // A custom range is resolved inside the same plan window, so a typed URL can't read further back.
  const range = resolveRange({ days, from: q.get("from"), to: q.get("to") }, w.maxDays ?? days);
  const r = range.custom ? await buildRangeReport(user, range, q.get("account")) : await buildClientReport(user, days, q.get("account"));
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = r.scope.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "all";
  const name = `outlly-report-${slug}-${reportStamp(range)}-${stamp}.${format}`;
  const body = format === "csv" ? new TextEncoder().encode(reportCsv(r)) : new Uint8Array(reportPdf(r));
  return new NextResponse(body, {
    headers: {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
}, { limit: [12, 60_000] });
