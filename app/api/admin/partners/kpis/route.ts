import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { kpis } from "@/lib/partners/admin";

export const dynamic = "force-dynamic";

export const GET = adminRoute("partners", async () => json({ kpis: await kpis() }));
