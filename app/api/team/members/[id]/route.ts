import { z } from "zod";
import { db } from "@/lib/db";
import { json, route, HttpError } from "@/lib/http";
import { TEAM_ROLES } from "@/lib/team/roles";
import { teamFor } from "@/lib/team/service";
import { SCOPE_MAX } from "@/lib/profiles-core";

async function own(ownerId: string, id: string) {
  const m = await db.teamMember.findFirst({ where: { id, ownerId } });
  if (!m) throw new HttpError(404, "That person isn't on your team.", "NOT_FOUND");
  return m;
}

const patch = z
  .object({
    role: z.enum(TEAM_ROLES).optional(),
    // 1037 delegation: the accounts this person may work on. null = all of them.
    accountIds: z.array(z.string().cuid()).max(SCOPE_MAX).nullable().optional(),
  })
  .refine((b) => b.role !== undefined || b.accountIds !== undefined, "Nothing to change.");

export const PATCH = route(async (req, { user, params }) => {
  const { role, accountIds } = patch.parse(await req.json());
  await own(user.id, params.id);
  let ids: string | null | undefined;
  if (accountIds !== undefined) {
    if (accountIds === null) ids = null;
    else {
      const real = await db.socialAccount.findMany({ where: { userId: user.id, id: { in: accountIds } }, select: { id: true } });
      if (real.length !== new Set(accountIds).size) throw new HttpError(400, "One of those accounts isn't connected any more. Refresh and try again.", "BAD_ACCOUNT");
      ids = JSON.stringify(real.map((r) => r.id));
    }
  }
  await db.teamMember.update({ where: { id: params.id }, data: { ...(role ? { role } : {}), ...(ids !== undefined ? { accountIds: ids } : {}) } });
  return json(await teamFor(user.id));
});

/** Remove a member or revoke an invite. Their access ends on their next request. */
export const DELETE = route(async (_req, { user, params }) => {
  await own(user.id, params.id);
  await db.teamMember.delete({ where: { id: params.id } });
  return json(await teamFor(user.id));
});
