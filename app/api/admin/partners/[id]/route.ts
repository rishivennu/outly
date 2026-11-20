import { HttpError, json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { getApplication } from "@/lib/partners/admin";

export const dynamic = "force-dynamic";

/** Admin-only: the full record, internal notes included. Creator-facing pages never read this route. */
export const GET = adminRoute<{ params: { id: string } }>("partners", async (_req, { params }) => {
  const app = await getApplication(params.id);
  if (!app) throw new HttpError(404, "That application no longer exists.", "NOT_FOUND");
  return json({ application: app }, { headers: { "Cache-Control": "private, no-store" } });
});
