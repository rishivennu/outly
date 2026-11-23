import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { userDetail } from "@/lib/admin/app-analytics";

export const dynamic = "force-dynamic";

/** R1308: one person's activity (events, sessions, platforms, features). Email masked for roles that cannot see it. */
export const GET = adminRoute<{ params: { id: string } }>("appAnalytics", async (_req, { admin, params }) => {
  const d = await userDetail(params.id, admin.role);
  if (!d) return json({ error: "No such user.", code: "NOT_FOUND" }, { status: 404 });
  return json(d, { headers: { "cache-control": "no-store" } });
});
