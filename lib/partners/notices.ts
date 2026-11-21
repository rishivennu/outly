import "server-only";
import { db } from "../db";
import { recordEvent } from "../notify-engine";
import type { NoticeInput } from "../retention/notices";
import { fmtDay } from "./offer-core";

/**
 * R1289: in-app notices for the creator's own partnership, through the shared event queue (lib/notify-engine.ts).
 * Email stays with lib/partners/email.ts: these payloads never ask the notice layer to mail, so nothing arrives twice.
 * The idempotency key names the thing that happened (a status event, a grant, a deliverable due date), so a retry or a
 * second caller is a no-op.
 */
export const PARTNER_NOTICE_EVENTS = [
  "received",
  "under_review",
  "info_received",
  "more_info",
  "approved",
  "rejected",
  "offer_sent",
  "offer_accepted",
  "offer_declined",
  "active",
  "benefit",
  "completed",
  "withdrawn",
  "deadline",
] as const;
export type PartnerNoticeEvent = (typeof PARTNER_NOTICE_EVENTS)[number];

export interface PartnerNoticeExtra {
  stamp?: string;
  message?: string;
  plan?: string;
  endsAt?: Date | string | null;
  pending?: boolean;
  title?: string;
  dueAt?: Date | string | null;
}

type Kind = Extract<NoticeInput["kind"], "partner_update" | "partner_offer" | "partner_deadline">;

const clip = (s: string | undefined, n = 280) => {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

export const isPartnerNoticeEvent = (e: string): e is PartnerNoticeEvent => (PARTNER_NOTICE_EVENTS as readonly string[]).includes(e);

/** The words the creator reads. Pure, so every line is pinned by a test. */
export function partnerNoticeCopy(event: PartnerNoticeEvent, ref: string, x: PartnerNoticeExtra = {}): { kind: Kind; tone: NoticeInput["tone"]; title: string; body: string; action: string } {
  const track = "Track application";
  switch (event) {
    case "received":
      return { kind: "partner_update", tone: "info", title: "Application received", body: `Your application ${ref} has been received. We'll let you know when there's an update.`, action: track };
    case "under_review":
      return { kind: "partner_update", tone: "info", title: "Your application is under review", body: "Our team is reviewing your creator profile and engagement.", action: track };
    case "info_received":
      return { kind: "partner_update", tone: "info", title: "Thanks for the update", body: `We've added your new details to ${ref}. Our team is reviewing your application again.`, action: track };
    case "more_info":
      return { kind: "partner_update", tone: "warn", title: "More information needed", body: clip(x.message) || "Our team needs additional information.", action: "Update application" };
    case "approved":
      return { kind: "partner_update", tone: "info", title: "Your application has been approved", body: "Your application has been approved. We'll be in touch about the next step.", action: track };
    case "rejected":
      return { kind: "partner_update", tone: "info", title: "Update on your application", body: clip(x.message) || "Our team has reviewed your application and won't be moving forward right now.", action: "See details" };
    case "offer_sent":
      return { kind: "partner_offer", tone: "info", title: "You have a partnership offer", body: "A partnership offer is waiting for your response.", action: "Review offer" };
    case "offer_accepted":
      return { kind: "partner_offer", tone: "info", title: "Offer accepted", body: "You have accepted the collaboration terms. We're setting up your partnership.", action: "View partnership" };
    case "offer_declined":
      return { kind: "partner_offer", tone: "info", title: "Offer declined", body: "You declined the offer. We've let the team know.", action: track };
    case "active":
      return { kind: "partner_update", tone: "info", title: "Partnership activated", body: "Your collaboration is active. Your deliverables and benefits are in your dashboard.", action: "View partnership" };
    case "benefit": {
      const plan = x.plan || "Creator";
      const body = x.pending || !x.endsAt ? `Your complimentary ${plan} plan starts once your email is verified.` : `Your complimentary ${plan} plan is active until ${fmtDay(x.endsAt)}.`;
      return { kind: "partner_offer", tone: "info", title: "Creator subscription activated", body, action: "View partnership" };
    }
    case "completed":
      return { kind: "partner_update", tone: "info", title: "Partnership completed", body: "Your partnership has been completed. Thank you for creating with Outlly.", action: "View partnership" };
    case "withdrawn":
      return { kind: "partner_update", tone: "info", title: "Application withdrawn", body: clip(x.message) || `Application ${ref} has been withdrawn.`, action: track };
    case "deadline":
      return { kind: "partner_deadline", tone: "warn", title: "Deliverable due soon", body: `"${clip(x.title, 80) || "A deliverable"}" is due on ${fmtDay(x.dueAt ?? null)}. Submit the published link once it's live.`, action: "Submit link" };
  }
}

export const partnerHref = (ref: string) => `/dashboard/partnerships/${ref}`;
export const partnerIdemKey = (appId: string, event: string, stamp: string) => `partner:${appId}:${event}:${stamp}`;

/** Records the notice for the application's own account. No account linked: nothing to do. Never throws. */
export async function partnerNotice(app: { id: string; ref: string; userId: string | null }, event: string, extra: PartnerNoticeExtra = {}) {
  if (!app.userId || !isPartnerNoticeEvent(event)) return null;
  try {
    const c = partnerNoticeCopy(event, app.ref, extra);
    const key = partnerIdemKey(app.id, event, extra.stamp || "1").slice(0, 190);
    return await recordEvent({
      userId: app.userId,
      kind: c.kind,
      source: "partners",
      idemKey: key,
      payload: { kind: c.kind, tone: c.tone, title: c.title, body: c.body, href: partnerHref(app.ref), action: c.action, key },
    });
  } catch (e) {
    console.error("[partners] notice", e);
    return null;
  }
}

export const DEADLINE_LEAD_MS = 48 * 3_600_000;

/** Planned deliverables due within 48 hours get one reminder per due date (a moved date reminds again). */
export async function partnerDeadlineSweep(now = new Date()) {
  const rows = await db.partnerDeliverable.findMany({
    where: { status: "planned", dueAt: { gt: now, lte: new Date(now.getTime() + DEADLINE_LEAD_MS) }, application: { userId: { not: null }, status: { in: ["offer_accepted", "active"] } } },
    select: { id: true, title: true, dueAt: true, application: { select: { id: true, ref: true, userId: true } } },
    orderBy: { dueAt: "asc" },
    take: 200,
  });
  let fresh = 0;
  for (const d of rows) {
    const r = await partnerNotice(d.application, "deadline", { stamp: `${d.id}:${d.dueAt!.toISOString().slice(0, 10)}`, title: d.title, dueAt: d.dueAt });
    if (r && !r.duplicate) fresh++;
  }
  return { due: rows.length, fresh };
}
