import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { sendEmail, templates } from "../email";
import { checkSeats, entitlements } from "../billing/entitlements";
import { ROLE_INFO, WS_COOKIE, type TeamRole } from "./roles";

const INVITE_DAYS = 14;
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function teamFor(ownerId: string) {
  const [members, e] = await Promise.all([
    db.teamMember.findMany({ where: { ownerId }, orderBy: { createdAt: "asc" }, include: { user: { select: { name: true, avatar: true } } } }),
    entitlements(ownerId),
  ]);
  return {
    seats: { used: members.length, total: e.seats, plan: e.planName },
    members: members.map((m) => ({ id: m.id, email: m.email, name: m.user?.name ?? null, role: m.role as TeamRole, status: m.status as "invited" | "active", createdAt: m.createdAt.toISOString(), expired: m.status === "invited" && Date.now() - m.createdAt.getTime() > INVITE_DAYS * 864e5 })),
  };
}

/** Workspaces the signed-in person belongs to as a member (not their own). */
export async function memberships(userId: string) {
  const rows = await db.teamMember.findMany({ where: { userId, status: "active" }, include: { owner: { select: { id: true, name: true, email: true } } }, orderBy: { acceptedAt: "asc" } });
  return rows.map((r) => ({ ownerId: r.owner.id, ownerName: r.owner.name, ownerEmail: r.owner.email, role: r.role as TeamRole }));
}

export async function invite(owner: { id: string; name: string; email: string }, email: string, role: TeamRole) {
  email = email.trim().toLowerCase();
  if (email === owner.email.toLowerCase()) throw new HttpError(400, "That's you. Invite someone else.", "SELF");
  const existing = await db.teamMember.findUnique({ where: { ownerId_email: { ownerId: owner.id, email } } });
  if (existing?.status === "active") throw new HttpError(409, `${email} is already on your team.`, "EXISTS");
  if (!existing) checkSeats(await entitlements(owner.id), await db.teamMember.count({ where: { ownerId: owner.id } }));
  const token = randomBytes(24).toString("base64url");
  // re-inviting refreshes the link and the 14-day clock
  const m = existing
    ? await db.teamMember.update({ where: { id: existing.id }, data: { role, tokenHash: hashToken(token), createdAt: new Date() } })
    : await db.teamMember.create({ data: { ownerId: owner.id, email, role, tokenHash: hashToken(token) } });
  const url = `${env.APP_URL}/team/accept?token=${token}`;
  await sendEmail({ to: email, kind: "team_invite", subject: `${owner.name} invited you to Outlly`, html: templates.teamInvite({ owner: owner.name, role: ROLE_INFO[role].label, url }) }).catch(() => {});
  return { member: m, url };
}

export async function inviteByToken(token: string) {
  const m = await db.teamMember.findUnique({ where: { tokenHash: hashToken(token) }, include: { owner: { select: { id: true, name: true } } } });
  if (!m) return null;
  const expired = m.status === "invited" && Date.now() - m.createdAt.getTime() > INVITE_DAYS * 864e5;
  return { ...m, expired };
}

export async function accept(token: string, me: { id: string; email: string }) {
  const m = await inviteByToken(token);
  if (!m) throw new HttpError(404, "This invite link isn't valid any more. Ask for a new one.", "NOT_FOUND");
  if (m.expired) throw new HttpError(410, "This invite expired. Ask the owner to send it again.", "EXPIRED");
  if (m.ownerId === me.id) throw new HttpError(400, "That's your own workspace.", "SELF");
  if (m.email.toLowerCase() !== me.email.toLowerCase()) throw new HttpError(403, `This invite is for ${m.email}. Sign in with that email to accept it.`, "WRONG_EMAIL");
  if (m.status !== "active") await db.teamMember.update({ where: { id: m.id }, data: { userId: me.id, status: "active", acceptedAt: new Date() } });
  setWorkspace(m.ownerId);
  return { ownerId: m.ownerId, ownerName: m.owner.name, role: m.role as TeamRole };
}

export function setWorkspace(ownerId: string | null) {
  if (!ownerId) cookies().delete(WS_COOKIE);
  else cookies().set(WS_COOKIE, ownerId, { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
}
