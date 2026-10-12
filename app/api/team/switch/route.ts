import { z } from "zod";
import { db } from "@/lib/db";
import { json, route, HttpError } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { setWorkspace } from "@/lib/team/service";

/** { ownerId } opens a workspace you're a member of; { ownerId: null } goes back to your own. */
export const POST = route(async (req, { user }) => {
  const { ownerId } = z.object({ ownerId: z.string().min(1).max(60).nullable() }).parse(await req.json());
  const me = realUserId(user);
  if (ownerId && ownerId !== me) {
    const seat = await db.teamMember.findFirst({ where: { ownerId, userId: me, status: "active" } });
    if (!seat) throw new HttpError(403, "You're not on that team any more.", "NOT_MEMBER");
    setWorkspace(ownerId);
  } else setWorkspace(null);
  return json({ ok: true });
});
