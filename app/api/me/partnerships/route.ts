import { json, route } from "@/lib/http";
import { listMine } from "@/lib/partners/mine";

export const dynamic = "force-dynamic";

/** R1289: the signed-in creator's own partnership applications, with the summary cards. */
export const GET = route(async (_req, { user }) => json(await listMine(user), { headers: { "cache-control": "no-store" } }), { limit: [60, 60_000] });
