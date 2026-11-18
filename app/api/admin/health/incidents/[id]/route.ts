import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { note } from "@/lib/health/engine";
import { incidentRow } from "@/lib/health/overview";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const load = async (id: string) => {
  const inc = await db.healthIncident.findUnique({ where: { id } });
  if (!inc) throw new HttpError(404, "That incident is gone (resolved incidents are kept for 30 days).", "NOT_FOUND");
  return inc;
};

const detail = async (id: string) => {
  const inc = await load(id);
  const [notes, deliveries, checks] = await Promise.all([
    db.healthIncidentNote.findMany({ where: { incidentId: id }, orderBy: { createdAt: "asc" }, take: 200 }),
    db.healthAlertDelivery.findMany({ where: { incidentId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.healthCheck.findMany({ where: { service: inc.service, checkedAt: { gte: new Date(inc.firstDetectedAt.getTime() - 15 * 60_000) } }, orderBy: { checkedAt: "desc" }, take: 40, select: { status: true, latencyMs: true, detail: true, checkedAt: true } }),
  ]);
  return {
    incident: { ...incidentRow(inc), errorDetail: inc.errorDetail, ackAt: inc.ackAt?.toISOString() ?? null, escalatedAt: inc.escalatedAt?.toISOString() ?? null, notifiedAt: inc.notifiedAt?.toISOString() ?? null, recoveryNotifiedAt: inc.recoveryNotifiedAt?.toISOString() ?? null, assigneeId: inc.assigneeId, okStreak: inc.okStreak },
    notes: notes.map((n) => ({ id: n.id, kind: n.kind, text: n.text, by: n.adminName, at: n.createdAt.toISOString() })),
    deliveries: deliveries.map((d) => ({ id: d.id, kind: d.kind, channel: d.channel, status: d.status, detail: d.detail, at: d.createdAt.toISOString() })),
    checks: checks.map((c) => ({ status: c.status, latencyMs: c.latencyMs, detail: c.detail, at: c.checkedAt.toISOString() })),
  };
};

/** R1195: one incident, its audit trail, every alert attempt for it, and the checks around it. */
export const GET = adminRoute<Ctx>("health", async (_req, { params }) => json(await detail(params.id)));

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ack") }),
  z.object({ action: z.literal("investigate") }),
  z.object({ action: z.literal("assign"), assigneeId: z.string().max(40).nullable() }),
  z.object({ action: z.literal("note"), text: z.string().trim().min(1, "Write the note first.").max(2000) }),
  z.object({ action: z.literal("resolve"), text: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal("reopen"), text: z.string().trim().max(2000).optional() }),
]);

/**
 * Incident management. Acknowledge, investigate, assign and resolve are separate steps; acknowledging never
 * resolves, and only "resolve" (or two passing checks in a row, in the engine) closes an incident. Every step is
 * a HealthIncidentNote with who did it, so the trail is complete.
 */
export const PATCH = adminRoute<Ctx>(
  "health",
  async (req, { params, admin }) => {
    const b = Body.parse(await req.json());
    const inc = await load(params.id);
    const who = { id: admin.id, name: admin.name };
    const now = new Date();
    if (b.action === "ack") {
      if (inc.status === "resolved") throw new HttpError(409, "This incident is already resolved.", "RESOLVED");
      await db.healthIncident.update({ where: { id: inc.id }, data: { ackById: admin.id, ackAt: inc.ackAt ?? now, ...(inc.status === "open" ? { status: "acknowledged" } : {}) } });
      await note(inc.id, "ack", `${admin.name} acknowledged the incident`, who);
    } else if (b.action === "investigate") {
      if (inc.status === "resolved") throw new HttpError(409, "This incident is already resolved. Reopen it first.", "RESOLVED");
      await db.healthIncident.update({ where: { id: inc.id }, data: { status: "investigating", ackById: inc.ackById ?? admin.id, ackAt: inc.ackAt ?? now } });
      await note(inc.id, "status", `${admin.name} is investigating`, who);
    } else if (b.action === "assign") {
      const to = b.assigneeId ? await db.adminUser.findUnique({ where: { id: b.assigneeId }, select: { id: true, name: true, active: true } }) : null;
      if (b.assigneeId && (!to || !to.active)) throw new HttpError(404, "That admin was not found.", "NOT_FOUND");
      await db.healthIncident.update({ where: { id: inc.id }, data: { assigneeId: to?.id ?? null, assigneeName: to?.name ?? null } });
      await note(inc.id, "assign", to ? `${admin.name} assigned this to ${to.id === admin.id ? "themselves" : to.name}` : `${admin.name} removed the assignee`, who);
    } else if (b.action === "note") {
      await note(inc.id, "note", b.text, who);
    } else if (b.action === "resolve") {
      if (inc.status === "resolved") throw new HttpError(409, "This incident is already resolved.", "RESOLVED");
      await db.healthIncident.update({ where: { id: inc.id }, data: { status: "resolved", resolvedAt: now, resolvedBy: admin.login, recoveryNotifiedAt: inc.recoveryNotifiedAt ?? now } });
      await note(inc.id, "status", `${admin.name} resolved the incident${b.text ? `: ${b.text}` : ""}`, who);
    } else {
      if (inc.status !== "resolved") throw new HttpError(409, "This incident is still open.", "OPEN");
      await db.healthIncident.update({ where: { id: inc.id }, data: { status: "open", resolvedAt: null, resolvedBy: null, okStreak: 0, recoveryNotifiedAt: null, lastObservedAt: now } });
      await note(inc.id, "status", `${admin.name} reopened the incident${b.text ? `: ${b.text}` : ""}`, who);
    }
    return json({ ok: true, ...(await detail(inc.id)) });
  },
  [60, 60_000],
);
