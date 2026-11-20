import { adminRoute } from "@/lib/admin/route";
import { exportApplications, toCsv } from "@/lib/partners/admin";

export const dynamic = "force-dynamic";

/** CSV of the list as currently filtered (same query params as the list). */
export const GET = adminRoute("partners", async (req) => {
  const rows = await exportApplications(Object.fromEntries(req.nextUrl.searchParams.entries()));
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${toCsv(rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="creator-partnerships-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}, [10, 60_000]);
