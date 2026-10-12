import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { WS_COOKIE } from "@/lib/team/roles";
import { setWorkspace } from "@/lib/team/service";

export const POST = route(async (req, { user }) => {
  const { ownerId } = z.object({ ownerId: z.string().min(1).max(60) }).parse(await req.json());
  await db.teamMember.deleteMany({ where: { ownerId, userId: realUserId(user) } });
  if (cookies().get(WS_COOKIE)?.value === ownerId) setWorkspace(null);
  return json({ ok: true });
});
