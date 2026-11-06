import { adminRoute } from "@/lib/admin/route";
import { waitlistCsv } from "@/lib/site";

export const dynamic = "force-dynamic";

/** Waitlist members as CSV (1142), with the same filters as the admin table. Read straight from the DB. */
export const GET = adminRoute("site", async (req) => {
  const q = req.nextUrl.searchParams;
  const sort = q.get("sort") === "old" ? "old" : "new";
  const status = q.get("status");
  const { csv } = await waitlistCsv({ q: q.get("q") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, sort, status: status === "waiting" || status === "invited" ? status : "all" });
  const stamp = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="outlly-waitlist-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}, [20, 60_000]);
