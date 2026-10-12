import { json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { memberships, teamFor } from "@/lib/team/service";

export const dynamic = "force-dynamic";

/** Your own team (when you're in your own workspace) and the workspaces you've joined. */
export const GET = route(async (_req, { user }) => {
  const me = realUserId(user);
  return json({
    current: user.actor ? { ownerId: user.id, ownerName: user.name, role: user.role } : null,
    team: user.actor ? null : await teamFor(user.id),
    workspaces: await memberships(me),
  });
});
