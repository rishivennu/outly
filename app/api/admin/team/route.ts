import { z } from "zod";
import { db } from "@/lib/db";
import { json, HttpError } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { hashAdminPassword } from "@/lib/admin/auth";

const Create = z.object({
  name: z.string().trim().min(1).max(60),
  login: z.string().trim().toLowerCase().regex(/^[a-z0-9._@-]{3,60}$/, "Login: 3-60 letters, numbers, dots or dashes"),
  role: z.enum(["super", "finance", "support"]),
  password: z.string().min(8, "Use at least 8 characters for new admins").max(200),
});

export const GET = adminRoute("team", async () => {
  const team = await db.adminUser.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, login: true, role: true, active: true, lastLoginAt: true, createdAt: true } });
  return json({ team });
});
export const POST = adminRoute("team", async (req) => {
  const d = Create.parse(await req.json());
  if (await db.adminUser.findUnique({ where: { login: d.login } })) throw new HttpError(409, "That login is taken.", "DUPLICATE");
  const a = await db.adminUser.create({ data: { name: d.name, login: d.login, role: d.role, passwordHash: await hashAdminPassword(d.password) }, select: { id: true, name: true, login: true, role: true, active: true, lastLoginAt: true, createdAt: true } });
  return json({ admin: a });
});

export const dynamic = "force-dynamic";
