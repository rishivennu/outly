import { z } from "zod";
import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { accept } from "@/lib/team/service";

export const POST = route(async (req, { user }) => {
  const { token } = z.object({ token: z.string().min(10).max(200) }).parse(await req.json());
  const me = await db.user.findUniqueOrThrow({ where: { id: realUserId(user) }, select: { id: true, email: true } });
  return json(await accept(token, me));
}, { limit: [10, 60_000] });
