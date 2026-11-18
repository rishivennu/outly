import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { incidentRow, rangeMs } from "@/lib/health/overview";
import { SERVICES } from "@/lib/health/registry";

export const dynamic = "force-dynamic";

const Query = z.object({
  status: z.enum(["active", "open", "acknowledged", "investigating", "resolved", "all"]).default("all"),
  severity: z.enum(["critical", "warning", "info", "all"]).default("all"),
  service: z.string().max(40).default(""),
  range: z.enum(["1h", "24h", "7d", "30d"]).default("7d"),
  q: z.string().max(80).default(""),
  format: z.enum(["json", "csv"]).default("json"),
  take: z.coerce.number().int().min(1).max(500).default(200),
});

/** R1195 incident history with filters, and the same list as a CSV file (format=csv). */
export const GET = adminRoute("health", async (req) => {
  const p = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const now = new Date();
  const since = new Date(now.getTime() - rangeMs(p.range));
  const where: Prisma.HealthIncidentWhereInput = {
    ...(p.status === "active" ? { status: { not: "resolved" } } : p.status === "all" ? {} : { status: p.status }),
    ...(p.severity === "all" ? {} : { severity: p.severity }),
    ...(p.service ? { service: p.service } : {}),
    // The range is about when something happened: an incident that is still open always shows.
    OR: [{ status: { not: "resolved" } }, { firstDetectedAt: { gte: since } }, { resolvedAt: { gte: since } }],
    ...(p.q ? { AND: [{ OR: [{ title: { contains: p.q } }, { description: { contains: p.q } }, { service: { contains: p.q } }] }] } : {}),
  };
  const rows = await db.healthIncident.findMany({ where, orderBy: { firstDetectedAt: "desc" }, take: p.take });
  // Still-open incidents first, newest first within each half.
  const list = rows.sort((x, y) => Number(!!x.resolvedAt) - Number(!!y.resolvedAt) || y.firstDetectedAt.getTime() - x.firstDetectedAt.getTime()).map(incidentRow);
  if (p.format === "csv") {
    const head = ["id", "service", "severity", "title", "status", "firstDetectedAt", "lastObservedAt", "resolvedAt", "resolvedBy", "durationMin", "occurrences", "affectedCount", "assignee", "acknowledged", "escalated", "likelyCause", "description"];
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
    const body = list.map((i) => [i.id, i.service, i.severity, i.title, i.status, i.firstDetectedAt, i.lastObservedAt, i.resolvedAt ?? "", i.resolvedBy ?? "", Math.round(i.durationMs / 60_000), i.occurrences, i.affectedCount, i.assigneeName ?? "", i.acknowledged ? "yes" : "no", i.escalated ? "yes" : "no", i.likelyCause, i.description].map(cell).join(","));
    const csv = [head.join(","), ...body].join("\r\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="outlly-incidents-${now.toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
  }
  return json({ incidents: list, total: list.length, truncated: list.length >= p.take, services: SERVICES.map((s) => ({ id: s.id, name: s.name })) });
});
