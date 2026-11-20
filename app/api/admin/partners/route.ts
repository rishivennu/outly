import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { listApplications } from "@/lib/partners/admin";

export const dynamic = "force-dynamic";

export const GET = adminRoute("partners", async (req) => {
  const sp = req.nextUrl.searchParams;
  const r = await listApplications(Object.fromEntries(sp.entries()));
  return json(r);
});
