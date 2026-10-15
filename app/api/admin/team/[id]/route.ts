import { ADMIN_ROLES } from "@/lib/admin/perms";
import { z } from "zod";
import { db } from "@/lib/db";
import { json, HttpError } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";

const Patch = z.object({ role: z.enum(ADMIN_ROLES).optional(), active: z.boolean().optional() });

/** Guard: there must always be at least one active super admin, or nobody can manage the team. */
async function keepsASuper(id: string, next: { role?: string; active?: boolean } | "delete") {
  const supers = await db.adminUser.findMany({ where: { role: "super", active: true }, select: { id: true } });
  const remaining = supers.filter((s) => s.id !== id || (next !== "delete" && (next.role ?? "super") === "super" && next.active !== false));
  return remaining.length > 0;
}

export const PATCH = adminRoute<{ params: { id: string } }>("team", async (req, { params }) => {
  const d = Patch.parse(await req.json());
  if (!(await keepsASuper(params.id, d))) throw new HttpError(409, "Keep at least one active super admin.", "LAST_SUPER");
  const a = await db.adminUser.update({ where: { id: params.id }, data: d, select: { id: true, name: true, login: true, role: true, active: true, lastLoginAt: true, createdAt: true } });
  return json({ admin: a });
});
export const DELETE = adminRoute<{ params: { id: string } }>("team", async (_req, { params, admin }) => {
  if (params.id === admin.id) throw new HttpError(409, "You can't remove yourself.", "SELF");
  if (!(await keepsASuper(params.id, "delete"))) throw new HttpError(409, "Keep at least one active super admin.", "LAST_SUPER");
  await db.adminUser.delete({ where: { id: params.id } }).catch(() => null);
  return json({ ok: true });
});
