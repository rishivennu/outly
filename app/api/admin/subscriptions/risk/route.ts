import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { listFlags } from "../_lib/report";

export const dynamic = "force-dynamic";

/** The review queue: open flags first by score. ?status=open|verified|cleared|confirmed|all */
export const GET = adminRoute("pricing", async (req) => json(await listFlags({ status: req.nextUrl.searchParams.get("status") ?? "open" })));
