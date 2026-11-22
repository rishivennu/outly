import { z } from "zod";
import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { accept, inviteByToken } from "@/lib/team/service";
import { ROLE_INFO } from "@/lib/team/roles";

/**
 * What app/team/accept/page.tsx reads server-side, for the native app: the invite behind ?token= (null when unknown or
 * too short), with the owner's name so the page can say who invited you. Works signed out, like the page.
 */
export const GET = route(
  async (req) => {
    const token = req.nextUrl.searchParams.get("token") ?? "";
    const m = token.length >= 10 && token.length <= 200 ? await inviteByToken(token) : null;
    const invite = m
      ? { email: m.email, role: m.role in ROLE_INFO ? m.role : "editor", expired: m.expired, ownerId: m.ownerId, ownerName: m.owner.name }
      : null;
    return json({ invite }, { headers: { "cache-control": "no-store" } });
  },
  { auth: false, limit: [30, 60_000] },
);

export const POST = route(async (req, { user }) => {
  const { token } = z.object({ token: z.string().min(10).max(200) }).parse(await req.json());
  const me = await db.user.findUniqueOrThrow({ where: { id: realUserId(user) }, select: { id: true, email: true } });
  return json(await accept(token, me));
}, { limit: [10, 60_000] });
