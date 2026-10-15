import { adminEvent, adminRoute } from "@/lib/admin/route";
import { leads } from "@/lib/admin/growth";
import { LISTS, toCsv, type LeadKind } from "@/lib/growth/core";
import { HttpError } from "@/lib/http";

export const dynamic = "force-dynamic";

/** CSV of one lead list (optionally one temperature), for a spreadsheet or an email tool. */
export const GET = adminRoute(
  "growth",
  async (req, { admin }) => {
    const kind = req.nextUrl.searchParams.get("list") as LeadKind;
    const temp = req.nextUrl.searchParams.get("temp");
    const meta = LISTS.find((l) => l.kind === kind);
    if (!meta) throw new HttpError(400, "Pick a list to export.", "VALIDATION");
    const rows = (await leads(kind, new Date(), 5000)).filter((l) => !temp || l.temp === temp);
    const csv = toCsv(
      ["name", "email", "score", "temperature", "since", "detail", "last_growth_email"],
      rows.map((l) => [l.name, l.email, l.score, l.temp, l.since.toISOString().slice(0, 10), l.detail, l.emailedAt?.toISOString().slice(0, 10) ?? ""]),
    );
    await adminEvent("growth", `${admin.name} exported ${rows.length} leads`, `${meta.label}${temp ? `, ${temp} only` : ""}`, "/admin/growth");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="outlly-${kind}${temp ? `-${temp}` : ""}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  },
  [20, 60_000],
);
