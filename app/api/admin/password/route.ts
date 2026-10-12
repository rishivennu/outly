import { z } from "zod";
import { db } from "@/lib/db";
import { json, HttpError } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { checkAdminPassword, createAdminSession, hashAdminPassword } from "@/lib/admin/auth";

const Body = z.object({ current: z.string().min(1), next: z.string().min(8, "Use at least 8 characters").max(200) });

/** Any role can change its own password. Other sessions of this admin are signed out (fingerprint changes). */
export const POST = adminRoute("overview", async (req, { admin }) => {
  const d = Body.parse(await req.json());
  const a = await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
  if (!(await checkAdminPassword(d.current, a.passwordHash))) throw new HttpError(400, "Current password is wrong.", "BAD_PASSWORD");
  if (d.current === d.next) throw new HttpError(400, "Pick a password you haven't used here.", "SAME");
  const u = await db.adminUser.update({ where: { id: a.id }, data: { passwordHash: await hashAdminPassword(d.next) } });
  await createAdminSession(u); // keep THIS session alive
  return json({ ok: true });
}, [10, 60_000]);
