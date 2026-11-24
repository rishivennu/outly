import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { overview } from "@/lib/costs/overview";

export const dynamic = "force-dynamic";

/** R1314: the whole Infrastructure & Costs view as JSON (the page's refresh and the exports' source of truth). */
export const GET = adminRoute("costs", async (req) => {
  const sp = req.nextUrl.searchParams;
  return json(await overview({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined }));
});
