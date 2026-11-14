import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { listSubscribers } from "../_lib/report";

export const dynamic = "force-dynamic";

export const GET = adminRoute("pricing", async (req) => {
  const q = req.nextUrl.searchParams;
  return json(await listSubscribers({ q: q.get("q") ?? undefined, tier: q.get("tier") ?? undefined, status: q.get("status") ?? undefined, skip: Number(q.get("skip")) || 0, take: Number(q.get("take")) || 50 }));
});
