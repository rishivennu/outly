import { db } from "@/lib/db";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { can } from "@/lib/admin/perms";

const AREA: Record<string, Parameters<typeof can>[1]> = { payment_failed: "payments", subscription_new: "payments", ticket_new: "tickets", ticket_urgent: "tickets", plan_changed: "pricing", integration: "integrations" };

/** Polled every 15 s by the bell. Each role only sees events for areas it can open. */
export const GET = adminRoute("overview", async (req, { admin }) => {
  const since = req.nextUrl.searchParams.get("since");
  const rows = await db.adminEvent.findMany({ where: since ? { createdAt: { gt: new Date(since) } } : {}, orderBy: { createdAt: "desc" }, take: 30 });
  return json({ events: rows.filter((e) => can(admin.role, AREA[e.kind] ?? "overview")), now: new Date().toISOString() });
}, [30, 60_000]);

export const dynamic = "force-dynamic";
