import "server-only";
import { z } from "zod";
import { db } from "../db";
import { HttpError } from "../http";
import { adminEvent } from "../admin/route";
import type { PartnerActor } from "./admin";
import { acceptedOfferByToken } from "./offers";
import { DELIVERABLE_STATUSES, PARTNER_PLATFORMS } from "./types";
import { DELIVERABLE_APPROVALS } from "./offer-core";

export { DELIVERABLE_APPROVALS, DELIVERABLE_APPROVAL_LABEL } from "./offer-core";

const url = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/i.test(v), "Paste the full link, starting with https://");
const day = z
  .string()
  .trim()
  .max(40)
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Enter the date as YYYY-MM-DD." });
      return z.NEVER;
    }
    return d;
  });
const count = z.number().int().min(0).max(2_000_000_000);

export const DeliverableCreate = z.object({
  title: z.string().trim().min(2, "Give it a short title.").max(160),
  platform: z.enum(PARTNER_PLATFORMS),
  format: z.string().trim().max(120).default(""),
  dueAt: day,
  offerId: z.string().max(40).nullable().optional(),
  approval: z.enum(DELIVERABLE_APPROVALS).default("none"),
});

export const DeliverableUpdate = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  platform: z.enum(PARTNER_PLATFORMS).optional(),
  format: z.string().trim().max(120).optional(),
  dueAt: day,
  publishedAt: day,
  url: url.optional(),
  approval: z.enum(DELIVERABLE_APPROVALS).optional(),
  status: z.enum(DELIVERABLE_STATUSES).optional(),
  adminNote: z.string().trim().max(2000).optional(),
  views: count.optional(),
  reach: count.optional(),
  likes: count.optional(),
  comments: count.optional(),
  clicks: count.optional(),
});

export const DeliverableSubmit = z.object({
  id: z.string().min(1).max(40),
  url: url.refine((v) => v !== "", "Paste the link to the published post."),
  publishedAt: day,
  note: z.string().trim().max(1000).optional(),
  views: count.optional(),
  reach: count.optional(),
  likes: count.optional(),
  comments: count.optional(),
});

const event = (applicationId: string, actor: string, action: string, meta: Record<string, unknown> = {}) =>
  db.partnerEvent.create({ data: { applicationId, actor: actor.slice(0, 120), action, meta: JSON.stringify(meta).slice(0, 4000) } });

async function own(applicationId: string, id: string) {
  const d = await db.partnerDeliverable.findUnique({ where: { id: id.slice(0, 40) } });
  if (!d || d.applicationId !== applicationId) throw new HttpError(404, "That deliverable no longer exists.", "NOT_FOUND");
  return d;
}

export function listDeliverables(applicationId: string) {
  return db.partnerDeliverable.findMany({ where: { applicationId }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }] });
}

export async function createDeliverable(applicationId: string, input: unknown, admin: PartnerActor) {
  const app = await db.partnerApplication.findUnique({ where: { id: applicationId.slice(0, 40) }, select: { id: true } });
  if (!app) throw new HttpError(404, "That application no longer exists.", "NOT_FOUND");
  const d = DeliverableCreate.parse(input);
  if (d.offerId) {
    const o = await db.partnerOffer.findUnique({ where: { id: d.offerId }, select: { applicationId: true } });
    if (!o || o.applicationId !== app.id) throw new HttpError(400, "That offer belongs to another application.", "VALIDATION");
  }
  const row = await db.partnerDeliverable.create({ data: { ...d, offerId: d.offerId ?? null, applicationId: app.id } });
  await event(app.id, admin.login, "deliverable.add", { deliverableId: row.id, title: row.title });
  return row;
}

/** Admin edit and review in one: a change of status or approval is logged as a review. */
export async function updateDeliverable(applicationId: string, id: string, input: unknown, admin: PartnerActor) {
  const before = await own(applicationId, id);
  const d = DeliverableUpdate.parse(input);
  const data = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
  const row = await db.partnerDeliverable.update({ where: { id: before.id }, data });
  const reviewed = (d.status && d.status !== before.status) || (d.approval && d.approval !== before.approval);
  await event(applicationId, admin.login, reviewed ? "deliverable.review" : "deliverable.update", {
    deliverableId: row.id,
    ...(reviewed ? { from: before.status, to: row.status, approval: row.approval } : {}),
  });
  return row;
}

export async function deleteDeliverable(applicationId: string, id: string, admin: PartnerActor) {
  const d = await own(applicationId, id);
  await db.partnerDeliverable.delete({ where: { id: d.id } });
  await event(applicationId, admin.login, "deliverable.delete", { deliverableId: d.id, title: d.title });
  return { ok: true };
}

/** Creator-facing fields only: no admin note. */
export const publicDeliverable = (d: Awaited<ReturnType<typeof listDeliverables>>[number]) => ({
  id: d.id, title: d.title, platform: d.platform, format: d.format, dueAt: d.dueAt?.toISOString() ?? null, publishedAt: d.publishedAt?.toISOString() ?? null,
  url: d.url, status: d.status, approval: d.approval, views: d.views, reach: d.reach, likes: d.likes, comments: d.comments, creatorNote: d.creatorNote,
});
export type PublicDeliverable = ReturnType<typeof publicDeliverable>;

/** The creator posts the published link from the portal. Verified and missed items are closed. */
export async function submitDeliverable(token: string, input: unknown) {
  const offer = await acceptedOfferByToken(token);
  if (!offer) throw new HttpError(404, "This portal link isn't active. Check the link in your email.", "NOT_FOUND");
  const d = DeliverableSubmit.parse(input);
  const before = await own(offer.applicationId, d.id);
  if (before.status === "verified" || before.status === "missed") throw new HttpError(409, "This item is closed. Reply to the email if something needs to change.", "CLOSED");
  const row = await db.partnerDeliverable.update({
    where: { id: before.id },
    data: {
      url: d.url, publishedAt: d.publishedAt ?? new Date(), creatorNote: d.note ?? before.creatorNote, status: "submitted",
      ...(d.views !== undefined ? { views: d.views } : {}), ...(d.reach !== undefined ? { reach: d.reach } : {}),
      ...(d.likes !== undefined ? { likes: d.likes } : {}), ...(d.comments !== undefined ? { comments: d.comments } : {}),
    },
  });
  await event(offer.applicationId, "creator", "deliverable.submit", { deliverableId: row.id, url: row.url });
  await adminEvent("partner", `${offer.application.fullName} submitted a deliverable`, row.title, `/admin/partners/${offer.applicationId}`);
  return publicDeliverable(row);
}
