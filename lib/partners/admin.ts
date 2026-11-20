import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { HttpError } from "../http";
import { adminEvent } from "../admin/route";
import { sendPartnerStatusEmail } from "./email";
import {
  PARTNER_NICHES,
  PARTNER_PLATFORMS,
  PARTNER_PREFERENCES,
  PARTNER_STATUSES,
  PARTNER_STATUS_LABEL,
  PARTNER_TIERS,
  canTransition,
  type PartnerProposal,
  type PartnerSocial,
  type PartnerStats,
  type PartnerStatus,
} from "./types";

export const PARTNERS_PER_PAGE = 25;
export const PARTNER_SORTS = ["createdAt", "followers", "avgViews", "engagementRate"] as const;
export type PartnerSort = (typeof PARTNER_SORTS)[number];

/** Statuses that need the admin's words, because the creator is told why. */
export const MESSAGE_REQUIRED: PartnerStatus[] = ["more_info", "rejected"];

export interface PartnerListQuery {
  q?: string;
  status?: string;
  platform?: string;
  tier?: string;
  niche?: string;
  preference?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: string;
  page?: number | string;
}

export interface PartnerActor {
  login: string;
  role?: string | null;
}

// Postgres matches text case-sensitively unless asked; SQLite (dev) already ignores case and has no `mode`.
const ci = (process.env.DATABASE_URL ?? "").startsWith("postgres") ? { mode: "insensitive" as const } : {};
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | "" => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : "");
const day = (v: unknown, end = false) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/** Normalises any query (URL params or a page's searchParams) to safe values; anything unknown means "no filter". */
export function normaliseQuery(q: PartnerListQuery) {
  return {
    q: typeof q.q === "string" ? q.q.trim().slice(0, 120) : "",
    status: oneOf(q.status, PARTNER_STATUSES),
    platform: oneOf(q.platform, PARTNER_PLATFORMS),
    tier: oneOf(q.tier, PARTNER_TIERS),
    niche: oneOf(q.niche, PARTNER_NICHES),
    preference: oneOf(q.preference, PARTNER_PREFERENCES),
    from: day(q.from) ? String(q.from) : "",
    to: day(q.to) ? String(q.to) : "",
    sort: oneOf(q.sort, PARTNER_SORTS) || "createdAt",
    dir: q.dir === "asc" ? ("asc" as const) : ("desc" as const),
    page: Math.min(10_000, Math.max(1, Math.floor(Number(q.page)) || 1)),
  };
}

export function partnerWhere(query: PartnerListQuery): Prisma.PartnerApplicationWhereInput {
  const n = normaliseQuery(query);
  const and: Prisma.PartnerApplicationWhereInput[] = [];
  if (n.q) {
    const handle = n.q.replace(/^@/, "");
    and.push({
      OR: [
        { fullName: { contains: n.q, ...ci } },
        { email: { contains: n.q.toLowerCase(), ...ci } },
        { primaryHandle: { contains: handle, ...ci } },
        { socials: { contains: handle, ...ci } },
        { ref: { contains: n.q, ...ci } },
        { brandName: { contains: n.q, ...ci } },
      ],
    });
  }
  if (n.status) and.push({ status: n.status });
  if (n.platform) and.push({ OR: [{ primaryPlatform: n.platform }, { socials: { contains: `"platform":"${n.platform}"` } }] });
  if (n.tier) and.push({ tier: n.tier });
  if (n.niche) and.push({ niche: n.niche });
  if (n.preference) and.push({ preference: n.preference });
  const from = day(n.from);
  const to = day(n.to, true);
  if (from || to) and.push({ createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
  return and.length ? { AND: and } : {};
}

const LIST_SELECT = {
  id: true, ref: true, status: true, fullName: true, email: true, country: true, primaryPlatform: true, primaryHandle: true,
  followers: true, avgViews: true, engagementRate: true, niche: true, tier: true, preference: true, createdAt: true, updatedAt: true,
} satisfies Prisma.PartnerApplicationSelect;

export type PartnerListRow = Prisma.PartnerApplicationGetPayload<{ select: typeof LIST_SELECT }>;

export async function listApplications(query: PartnerListQuery, take = PARTNERS_PER_PAGE) {
  const n = normaliseQuery(query);
  const where = partnerWhere(query);
  const orderBy: Prisma.PartnerApplicationOrderByWithRelationInput[] =
    n.sort === "engagementRate"
      ? [{ engagementRate: { sort: n.dir, nulls: "last" } }, { createdAt: "desc" }]
      : n.sort === "createdAt"
        ? [{ createdAt: n.dir }]
        : [{ [n.sort]: n.dir }, { createdAt: "desc" }];
  const total = await db.partnerApplication.count({ where });
  const pages = Math.max(1, Math.ceil(total / take));
  const page = Math.min(pages, n.page);
  const rows = await db.partnerApplication.findMany({ where, orderBy, take, skip: (page - 1) * take, select: LIST_SELECT });
  return { rows, total, page, limit: take, query: n };
}

/** Every row of the current filter, for the CSV export. Capped so one click can never pull the whole table into memory. */
export async function exportApplications(query: PartnerListQuery, cap = 5000) {
  const { rows } = await listApplications({ ...query, page: 1 }, cap);
  return rows;
}

export type PartnerKpis = {
  total: number; submitted: number; underReview: number; moreInfo: number; approved: number; offerSent: number; active: number; rejected: number;
};

export async function kpis(): Promise<PartnerKpis> {
  const [groups, pendingOffers] = await Promise.all([
    db.partnerApplication.groupBy({ by: ["status"], _count: { _all: true } }),
    db.partnerOffer.count({ where: { status: "sent" } }),
  ]);
  const by = (s: PartnerStatus) => groups.find((g) => g.status === s)?._count._all ?? 0;
  return {
    total: groups.reduce((a, g) => a + g._count._all, 0),
    submitted: by("submitted"),
    underReview: by("under_review"),
    moreInfo: by("more_info"),
    approved: by("approved"),
    offerSent: pendingOffers,
    active: by("active"),
    rejected: by("rejected"),
  };
}

export async function getApplication(id: string) {
  const app = await db.partnerApplication.findUnique({
    where: { id: id.slice(0, 40) },
    include: {
      files: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "desc" } },
      offers: { orderBy: { createdAt: "desc" }, include: { items: { orderBy: { createdAt: "asc" } } } },
      deliverables: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!app) return null;
  const counts = await db.partnerAttribution.groupBy({ by: ["kind"], where: { applicationId: app.id }, _count: { _all: true } });
  const count = (k: string) => counts.find((c) => c.kind === k)?._count._all ?? 0;
  return {
    ...app,
    socials: parseJson<PartnerSocial[]>(app.socials, []),
    stats: parseJson<Partial<PartnerStats>>(app.stats, {}),
    proposal: parseJson<Partial<PartnerProposal>>(app.proposal, {}),
    events: app.events.map((e) => ({ ...e, meta: parseJson<Record<string, unknown>>(e.meta, {}) })),
    attribution: { visits: count("visit"), signups: count("signup"), paid: count("paid") },
  };
}
export type PartnerDetail = NonNullable<Awaited<ReturnType<typeof getApplication>>>;

type AppRef = string | { id: string };

/**
 * The one way an application changes status (admin, creator or system). Enforces PARTNER_TRANSITIONS, writes the
 * PartnerEvent and the AuditLog row, then tells the creator. The message is the creator-facing text (more_info and
 * rejected need one from an admin); internal notes never pass through here.
 */
export async function changeStatus(
  app: AppRef,
  to: string,
  admin: PartnerActor,
  meta: { message?: string; link?: string; notify?: boolean; actor?: "admin" | "creator" | "system"; [k: string]: unknown } = {},
) {
  const id = typeof app === "string" ? app : app.id;
  const current = await db.partnerApplication.findUnique({ where: { id } });
  if (!current) throw new HttpError(404, "That application no longer exists.", "NOT_FOUND");
  if (!(PARTNER_STATUSES as readonly string[]).includes(to)) throw new HttpError(400, "That status does not exist.", "VALIDATION");
  const from = current.status;
  if (!canTransition(from, to)) {
    throw new HttpError(409, `An application that is ${PARTNER_STATUS_LABEL[from as PartnerStatus] ?? from} can't move to ${PARTNER_STATUS_LABEL[to as PartnerStatus]}.`, "BAD_TRANSITION");
  }
  const message = typeof meta.message === "string" ? meta.message.trim().slice(0, 2000) : "";
  const kind = meta.actor ?? (admin.login === "system" ? "system" : "admin");
  if (kind === "admin" && MESSAGE_REQUIRED.includes(to as PartnerStatus) && message.length < 3) {
    throw new HttpError(400, "Write the message the creator will read.", "MESSAGE_REQUIRED");
  }
  const now = new Date();
  const actor = kind === "admin" ? admin.login.slice(0, 120) : kind;
  const { notify: _n, actor: _a, message: _m, ...rest } = meta;
  const eventMeta = { ...rest, ...(message ? { message } : {}), ...(kind === "admin" ? { role: admin.role ?? null } : {}) };
  const updated = await db.$transaction(async (tx) => {
    // Only moves when nobody else moved it first (two admins clicking at once).
    const r = await tx.partnerApplication.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        ...(to === "under_review" && !current.reviewedAt ? { reviewedAt: now } : {}),
        ...(to === "approved" || to === "rejected" ? { decidedAt: now } : {}),
        ...(to === "withdrawn" ? { withdrawnAt: now } : {}),
      },
    });
    if (r.count !== 1) throw new HttpError(409, "Someone else changed this application. Refresh and try again.", "CONFLICT");
    await tx.partnerEvent.create({ data: { applicationId: id, actor, action: "status", from, to, meta: JSON.stringify(eventMeta).slice(0, 4000) } });
    await tx.auditLog.create({
      data: {
        actor: admin.login.slice(0, 120), actorRole: admin.role ?? null, action: "partner.status", targetType: "partner", targetId: id,
        email: current.email.toLowerCase(), before: JSON.stringify({ status: from }), after: JSON.stringify({ status: to }), note: message.slice(0, 500),
      },
    });
    return tx.partnerApplication.findUniqueOrThrow({ where: { id } });
  });
  if (meta.notify !== false) {
    // The status change already happened; a mail outage must not undo it or show the admin an error.
    try {
      await sendPartnerStatusEmail(updated, to as PartnerStatus, { ...(message ? { message } : {}), ...(meta.link ? { link: meta.link } : {}) });
    } catch (e) {
      console.error("[partners] status email", e);
    }
  }
  if (kind === "admin") {
    await adminEvent("partner", `${updated.fullName}: ${PARTNER_STATUS_LABEL[to as PartnerStatus]}`, `${PARTNER_STATUS_LABEL[from as PartnerStatus] ?? from} to ${PARTNER_STATUS_LABEL[to as PartnerStatus]} by ${admin.login}`, `/admin/partners/${id}`);
  }
  return updated;
}

/** Internal note: stays in the admin area, never in an email or a creator page. */
export async function addNote(applicationId: string, body: string, admin: PartnerActor) {
  const text = body.trim().slice(0, 4000);
  if (text.length < 1) throw new HttpError(400, "Write the note first.", "VALIDATION");
  const app = await db.partnerApplication.findUnique({ where: { id: applicationId }, select: { id: true } });
  if (!app) throw new HttpError(404, "That application no longer exists.", "NOT_FOUND");
  const note = await db.partnerNote.create({ data: { applicationId, author: admin.login.slice(0, 120), body: text } });
  await db.partnerEvent.create({ data: { applicationId, actor: admin.login.slice(0, 120), action: "note", meta: "{}" } });
  return note;
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(rows: PartnerListRow[]) {
  const head = ["Ref", "Status", "Name", "Email", "Country", "Platform", "Handle", "Followers", "Avg views", "Engagement %", "Niche", "Tier", "Preference", "Applied"];
  const lines = rows.map((r) =>
    [r.ref, PARTNER_STATUS_LABEL[r.status as PartnerStatus] ?? r.status, r.fullName, r.email, r.country, r.primaryPlatform, r.primaryHandle, r.followers, r.avgViews, r.engagementRate ?? "", r.niche, r.tier, r.preference, r.createdAt]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...lines].join("\r\n");
}
