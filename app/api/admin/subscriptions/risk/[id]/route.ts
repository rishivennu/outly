import { z } from "zod";
import { json, HttpError } from "@/lib/http";
import { db } from "@/lib/db";
import { adminRoute } from "@/lib/admin/route";
import { clearFlag, confirmFlag } from "@/lib/subscriptions/risk";
import { subsAudit } from "../../_lib/report";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["clear", "confirm", "note"]), note: z.string().trim().max(1000).optional() });

/** Clear restores trial and first-time eligibility; confirm keeps the account on standard pricing; note only records why. */
export const POST = adminRoute<{ params: { id: string } }>("pricing", async (req, { params, admin }) => {
  const b = Body.parse(await req.json());
  const id = String(params.id).slice(0, 40);
  const before = await db.riskFlag.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "That flag is gone.");
  if (b.action === "note" && !b.note) throw new HttpError(400, "Write a note first.", "VALIDATION");
  const after =
    b.action === "clear" ? await clearFlag(id, admin.login, b.note || before.note || undefined)
    : b.action === "confirm" ? await confirmFlag(id, admin.login, b.note || before.note || undefined)
    : await db.riskFlag.update({ where: { id }, data: { note: b.note!.slice(0, 1000), reviewedBy: admin.login.slice(0, 120), reviewedAt: new Date() } });
  const user = before.userId ? await db.user.findUnique({ where: { id: before.userId }, select: { email: true } }) : null;
  const verb = b.action === "clear" ? "cleared" : b.action === "confirm" ? "confirmed" : "noted";
  await subsAudit(admin, {
    action: `subs.risk.${b.action}`, targetType: "risk_flag", targetId: id, email: user?.email,
    before: { status: before.status, action: before.action, note: before.note }, after: { status: after.status, action: after.action, note: after.note }, note: b.note,
    title: `${admin.name} ${verb} a risk flag`, body: `${user?.email ?? "Deleted account"}, score ${before.score} (${before.level})`,
  });
  return json({ ok: true, flag: { id: after.id, status: after.status, action: after.action, note: after.note, reviewedBy: after.reviewedBy, reviewedAt: after.reviewedAt } });
}, [60, 60_000]);
