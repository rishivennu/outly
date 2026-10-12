import { z } from "zod";
import { json, route } from "@/lib/http";
import { TEAM_ROLES } from "@/lib/team/roles";
import { invite, teamFor } from "@/lib/team/service";

const Body = z.object({ email: z.string().trim().email("That email doesn't look right").max(200), role: z.enum(TEAM_ROLES) });

export const POST = route(async (req, { user }) => {
  const { email, role } = Body.parse(await req.json());
  const r = await invite(user, email, role);
  // The link is returned too, so the owner can share it directly when email isn't set up yet.
  return json({ ...(await teamFor(user.id)), inviteUrl: r.url });
}, { limit: [20, 60_000] });
