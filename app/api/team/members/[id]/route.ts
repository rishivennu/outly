import { z } from "zod";
import { db } from "@/lib/db";
import { json, route, HttpError } from "@/lib/http";
import { TEAM_ROLES } from "@/lib/team/roles";
import { teamFor } from "@/lib/team/service";

async function own(ownerId: string, id: string) {
  const m = await db.teamMember.findFirst({ where: { id, ownerId } });
  if (!m) throw new HttpError(404, "That person isn't on your team.", "NOT_FOUND");
  return m;
}

export const PATCH = route(async (req, { user, params }) => {
  const { role } = z.object({ role: z.enum(TEAM_ROLES) }).parse(await req.json());
  await own(user.id, params.id);
  await db.teamMember.update({ where: { id: params.id }, data: { role } });
  return json(await teamFor(user.id));
});

/** Remove a member or revoke an invite. Their access ends on their next request. */
export const DELETE = route(async (_req, { user, params }) => {
  await own(user.id, params.id);
  await db.teamMember.delete({ where: { id: params.id } });
  return json(await teamFor(user.id));
});
