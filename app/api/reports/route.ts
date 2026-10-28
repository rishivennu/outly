import { NextResponse } from "next/server";
import { route, HttpError } from "@/lib/http";
import { buildClientReport } from "@/lib/reports/client-report-server";
import { reportCsv, reportPdf } from "@/lib/reports/client-report";

export const dynamic = "force-dynamic";

/** GET /api/reports?format=csv|pdf&days=30&account=<id>: a client-ready analytics file (1037). */
export const GET = route(async (req, { user }) => {
  const q = req.nextUrl.searchParams;
  const format = q.get("format") ?? "pdf";
  if (format !== "csv" && format !== "pdf") throw new HttpError(400, "Pick csv or pdf.", "BAD_FORMAT");
  const days = Math.min(90, Math.max(7, Number(q.get("days") ?? 30) || 30));
  const r = await buildClientReport(user, days, q.get("account"));
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = r.scope.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "all";
  const name = `outlly-report-${slug}-${days}d-${stamp}.${format}`;
  const body = format === "csv" ? new TextEncoder().encode(reportCsv(r)) : new Uint8Array(reportPdf(r));
  return new NextResponse(body, {
    headers: {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
}, { limit: [12, 60_000] });
