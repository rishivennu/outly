import "server-only";
import type { Prisma, Workshop, WorkshopRegistration } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { adminEvent } from "../admin/route";
import { sendEmail, templates } from "../email";
import { CalendarError, calendarConnected, createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from "../google/calendar";
import { fmtWhen, googleCalendarUrl, icsText, parseTags, slugify, type WorkshopInputT, type WorkshopLevel, type WorkshopStatus, type WorkshopView } from "./core";

/**
 * R1309 workshops, server half: the database, the Google Calendar sync and the emails.
 *
 * The calendar is the source of the Meet link. Publishing a workshop (or saving a published one) upserts its Google
 * event with every registered creator as a guest; a registration or a cancellation patches the guest list; cancelling
 * the workshop deletes the event. Google emails the invites and updates itself (sendUpdates=all). Sync failures never
 * fail the admin's save or a creator's registration: they are stored on the row (googleError) and shown in the admin.
 */
const appUrl = () => env.APP_URL.replace(/\/$/, "");
export const workshopUrl = (slug: string) => `${appUrl()}/workshops/${slug}`;

const norm = (email: string) => email.trim().toLowerCase();

export function toView(w: Workshop & { _count?: { registrations: number } }, opts: { registered?: number; mine?: WorkshopRegistration | null; admin?: boolean; now?: Date } = {}): WorkshopView {
  const now = opts.now ?? new Date();
  const registered = opts.registered ?? w._count?.registrations ?? 0;
  const canSeeMeet = opts.admin || opts.mine?.status === "registered";
  return {
    id: w.id,
    slug: w.slug,
    title: w.title,
    summary: w.summary,
    description: w.description,
    host: w.host,
    level: w.level as WorkshopLevel,
    tags: parseTags(w.tags),
    startsAt: w.startsAt.toISOString(),
    endsAt: w.endsAt.toISOString(),
    timezone: w.timezone,
    capacity: w.capacity,
    status: w.status as WorkshopStatus,
    coverUrl: w.coverUrl,
    recordingUrl: w.recordingUrl,
    ...(canSeeMeet ? { meetUrl: w.meetUrl } : {}),
    registered,
    seatsLeft: w.capacity ? Math.max(0, w.capacity - registered) : null,
    past: w.endsAt.getTime() < now.getTime(),
    live: w.startsAt.getTime() <= now.getTime() && w.endsAt.getTime() >= now.getTime() && w.status === "published",
    mine: opts.mine === undefined ? undefined : opts.mine ? { status: opts.mine.status, createdAt: opts.mine.createdAt.toISOString() } : null,
    ...(opts.admin ? { googleEventId: w.googleEventId, googleError: w.googleError, googleSyncedAt: w.googleSyncedAt?.toISOString() ?? null, publishedAt: w.publishedAt?.toISOString() ?? null, cancelledAt: w.cancelledAt?.toISOString() ?? null, createdAt: w.createdAt.toISOString() } : {}),
  };
}

const activeCount = { registrations: { where: { status: "registered" } } } as const;

/** Public list: published upcoming (soonest first) and past sessions that have a recording (latest first). */
export async function listPublicWorkshops(now = new Date()): Promise<{ upcoming: WorkshopView[]; past: WorkshopView[] }> {
  const rows = await db.workshop.findMany({ where: { status: { in: ["published", "completed"] } }, orderBy: { startsAt: "asc" }, include: { _count: { select: activeCount } }, take: 200 });
  const upcoming = rows.filter((w) => w.endsAt.getTime() >= now.getTime() && w.status === "published").map((w) => toView(w, { now }));
  const past = rows
    .filter((w) => w.endsAt.getTime() < now.getTime())
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
    .slice(0, 24)
    .map((w) => toView(w, { now }));
  return { upcoming, past };
}

export async function getWorkshop(slug: string, viewer?: { id: string; email: string } | null, now = new Date()): Promise<WorkshopView | null> {
  const w = await db.workshop.findUnique({ where: { slug }, include: { _count: { select: activeCount } } });
  if (!w || w.status === "draft") return null;
  const mine = viewer ? await db.workshopRegistration.findUnique({ where: { workshopId_email: { workshopId: w.id, email: norm(viewer.email) } } }) : null;
  return toView(w, { mine: viewer ? mine : undefined, now });
}

/* ------------------------------------------------------------------ admin */

async function uniqueSlug(base: string, exceptId?: string) {
  const root = slugify(base) || "workshop";
  for (let n = 0; n < 50; n += 1) {
    const slug = n ? `${root}-${n + 1}` : root;
    const hit = await db.workshop.findUnique({ where: { slug }, select: { id: true } });
    if (!hit || hit.id === exceptId) return slug;
  }
  return `${root}-${Date.now().toString(36)}`;
}

const toData = (i: Partial<WorkshopInputT>): Prisma.WorkshopUpdateInput => ({
  ...(i.title !== undefined ? { title: i.title } : {}),
  ...(i.summary !== undefined ? { summary: i.summary } : {}),
  ...(i.description !== undefined ? { description: i.description } : {}),
  ...(i.host !== undefined ? { host: i.host } : {}),
  ...(i.level !== undefined ? { level: i.level } : {}),
  ...(i.tags !== undefined ? { tags: JSON.stringify(i.tags) } : {}),
  ...(i.startsAt !== undefined ? { startsAt: new Date(i.startsAt) } : {}),
  ...(i.endsAt !== undefined ? { endsAt: new Date(i.endsAt) } : {}),
  ...(i.timezone !== undefined ? { timezone: i.timezone } : {}),
  ...(i.capacity !== undefined ? { capacity: i.capacity } : {}),
  ...(i.coverUrl !== undefined ? { coverUrl: i.coverUrl } : {}),
  ...(i.meetUrl !== undefined ? { meetUrl: i.meetUrl } : {}),
  ...(i.recordingUrl !== undefined ? { recordingUrl: i.recordingUrl } : {}),
});

export async function listAdminWorkshops(now = new Date()): Promise<WorkshopView[]> {
  const rows = await db.workshop.findMany({ orderBy: { startsAt: "desc" }, include: { _count: { select: activeCount } }, take: 500 });
  return rows.map((w) => toView(w, { admin: true, now }));
}

export async function adminWorkshop(id: string, now = new Date()) {
  const w = await db.workshop.findUnique({ where: { id }, include: { _count: { select: activeCount } }, });
  if (!w) throw new HttpError(404, "That workshop no longer exists.", "NOT_FOUND");
  const registrations = await db.workshopRegistration.findMany({ where: { workshopId: id }, orderBy: { createdAt: "desc" }, take: 2000 });
  return { workshop: toView(w, { admin: true, now }), registrations: registrations.map((r) => ({ id: r.id, email: r.email, name: r.name, status: r.status, source: r.source, userId: r.userId, createdAt: r.createdAt.toISOString(), cancelledAt: r.cancelledAt?.toISOString() ?? null })) };
}

export async function createWorkshop(input: WorkshopInputT, admin: { name: string; login?: string }, opts: { publish?: boolean } = {}) {
  const slug = await uniqueSlug(input.slug || input.title);
  const w = await db.workshop.create({
    data: { ...(toData(input) as Prisma.WorkshopCreateInput), slug, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), title: input.title, createdBy: admin.login ?? admin.name, ...(opts.publish ? { status: "published", publishedAt: new Date() } : {}) },
  });
  await adminEvent("workshop", `${admin.name} created workshop "${w.title}"`, opts.publish ? "Published" : "Draft", "/admin/workshops");
  if (opts.publish) await syncWorkshopCalendar(w.id);
  return (await db.workshop.findUniqueOrThrow({ where: { id: w.id }, include: { _count: { select: activeCount } } }));
}

export async function updateWorkshop(id: string, patch: Partial<WorkshopInputT>, admin: { name: string }) {
  const cur = await db.workshop.findUnique({ where: { id } });
  if (!cur) throw new HttpError(404, "That workshop no longer exists.", "NOT_FOUND");
  const slug = patch.slug !== undefined && patch.slug !== cur.slug ? await uniqueSlug(patch.slug || patch.title || cur.title, id) : undefined;
  const startsAt = patch.startsAt ? new Date(patch.startsAt) : cur.startsAt;
  const endsAt = patch.endsAt ? new Date(patch.endsAt) : cur.endsAt;
  if (endsAt.getTime() <= startsAt.getTime()) throw new HttpError(400, "The workshop has to end after it starts.", "VALIDATION");
  const w = await db.workshop.update({ where: { id }, data: { ...toData(patch), ...(slug ? { slug } : {}) } });
  const moved = startsAt.getTime() !== cur.startsAt.getTime() || endsAt.getTime() !== cur.endsAt.getTime();
  await adminEvent("workshop", `${admin.name} edited workshop "${w.title}"`, moved ? "Time changed" : undefined, "/admin/workshops");
  if (w.status === "published") {
    await syncWorkshopCalendar(w.id);
    if (moved) await notifyRegistered(w.id, "rescheduled");
  }
  return db.workshop.findUniqueOrThrow({ where: { id }, include: { _count: { select: activeCount } } });
}

export async function setWorkshopStatus(id: string, status: "published" | "cancelled" | "completed" | "draft", admin: { name: string }) {
  const cur = await db.workshop.findUnique({ where: { id } });
  if (!cur) throw new HttpError(404, "That workshop no longer exists.", "NOT_FOUND");
  if (status === "draft" && cur.status !== "draft" && cur.googleEventId) throw new HttpError(409, "A workshop that is on Google Calendar can't go back to draft. Cancel it instead.", "CONFLICT");
  const data: Prisma.WorkshopUpdateInput = { status };
  if (status === "published" && !cur.publishedAt) data.publishedAt = new Date();
  if (status === "cancelled") data.cancelledAt = new Date();
  const w = await db.workshop.update({ where: { id }, data });
  await adminEvent("workshop", `${admin.name} ${status === "published" ? "published" : status} workshop "${w.title}"`, undefined, "/admin/workshops");
  if (status === "published") await syncWorkshopCalendar(w.id);
  if (status === "cancelled") {
    await removeCalendarEvent(w.id);
    await notifyRegistered(w.id, "cancelled");
  }
  return db.workshop.findUniqueOrThrow({ where: { id }, include: { _count: { select: activeCount } } });
}

/** Drafts only; anything that went public keeps its history (cancel it instead). */
export async function deleteWorkshop(id: string, admin: { name: string }) {
  const cur = await db.workshop.findUnique({ where: { id } });
  if (!cur) return;
  if (cur.status !== "draft") throw new HttpError(409, "Only drafts can be deleted. Cancel a published workshop instead.", "CONFLICT");
  await db.workshop.delete({ where: { id } });
  await adminEvent("workshop", `${admin.name} deleted draft "${cur.title}"`, undefined, "/admin/workshops");
}

/* --------------------------------------------------------- registrations */

export type RegisterResult = { registration: WorkshopRegistration; workshop: Workshop; created: boolean };

/**
 * Register a creator. One row per email per workshop (a second click, or the same inbox on two accounts, comes back
 * as the existing row with `created: false`). Capacity is checked in a transaction so two last-seat clicks can't both win.
 */
export async function registerForWorkshop(slug: string, who: { id?: string | null; email: string; name?: string }, source: "web" | "app" | "admin" = "web"): Promise<RegisterResult> {
  const email = norm(who.email);
  const w = await db.workshop.findUnique({ where: { slug } });
  if (!w || w.status === "draft") throw new HttpError(404, "That workshop isn't open.", "NOT_FOUND");
  if (w.status === "cancelled") throw new HttpError(409, "This workshop was cancelled.", "CANCELLED");
  if (w.endsAt.getTime() < Date.now()) throw new HttpError(409, "This workshop has already happened. Watch the recording instead.", "ENDED");
  const existing = await db.workshopRegistration.findUnique({ where: { workshopId_email: { workshopId: w.id, email } } });
  if (existing?.status === "registered") return { registration: existing, workshop: w, created: false };
  const registration = await db.$transaction(async (tx) => {
    if (w.capacity) {
      const n = await tx.workshopRegistration.count({ where: { workshopId: w.id, status: "registered" } });
      if (n >= w.capacity) throw new HttpError(409, "Every seat is taken. We'll open more sessions soon.", "FULL");
    }
    return existing
      ? tx.workshopRegistration.update({ where: { id: existing.id }, data: { status: "registered", cancelledAt: null, name: who.name ?? existing.name, userId: who.id ?? existing.userId, source } })
      : tx.workshopRegistration.create({ data: { workshopId: w.id, email, name: who.name ?? "", userId: who.id ?? null, source } });
  });
  // Guest list on Google, then our own confirmation (with the Meet link and the .ics). Neither failure undoes the seat.
  const synced = await syncWorkshopCalendar(w.id);
  await sendRegistrationEmail(synced ?? w, registration).catch((e) => console.error("[workshops] confirmation email", e));
  return { registration, workshop: synced ?? w, created: true };
}

export async function cancelRegistration(slug: string, email: string) {
  const w = await db.workshop.findUnique({ where: { slug } });
  if (!w) throw new HttpError(404, "That workshop isn't open.", "NOT_FOUND");
  const r = await db.workshopRegistration.findUnique({ where: { workshopId_email: { workshopId: w.id, email: norm(email) } } });
  if (!r || r.status !== "registered") return null;
  const out = await db.workshopRegistration.update({ where: { id: r.id }, data: { status: "cancelled", cancelledAt: new Date() } });
  await syncWorkshopCalendar(w.id);
  return out;
}

/** Everything a signed-in creator registered for, soonest first (the app and /home use it). */
export async function myWorkshops(email: string, now = new Date()) {
  const rows = await db.workshopRegistration.findMany({ where: { email: norm(email), status: "registered", workshop: { status: { in: ["published", "completed"] } } }, include: { workshop: { include: { _count: { select: activeCount } } } }, orderBy: { workshop: { startsAt: "asc" } }, take: 50 });
  return rows.map((r) => toView(r.workshop, { mine: r, now }));
}

/* ------------------------------------------------------------- calendar */

const guestList = (rows: WorkshopRegistration[]) => rows.filter((r) => r.status === "registered").map((r) => ({ email: r.email, name: r.name || undefined }));

/**
 * Upsert the Google event for a published workshop with the current guest list. Returns the fresh row, or null when
 * nothing was done (not connected, not published). Google errors are stored on the row, never thrown.
 */
export async function syncWorkshopCalendar(id: string): Promise<Workshop | null> {
  const w = await db.workshop.findUnique({ where: { id }, include: { registrations: true } });
  if (!w || w.status !== "published") return null;
  if (!(await calendarConnected())) return w;
  const input = { key: `outlly-ws-${w.id}`.replace(/[^a-z0-9-]/gi, "").slice(0, 60), title: `${w.title} · Outlly workshop`, description: [w.summary, w.description].filter(Boolean).join("\n\n"), startsAt: w.startsAt, endsAt: w.endsAt, timezone: w.timezone, url: workshopUrl(w.slug), attendees: guestList(w.registrations) };
  try {
    const ev = w.googleEventId ? await updateCalendarEvent(w.googleEventId, input) : await createCalendarEvent(input);
    return await db.workshop.update({ where: { id }, data: { googleEventId: ev.id || w.googleEventId, meetUrl: ev.meetUrl || w.meetUrl, googleSyncedAt: new Date(), googleError: "" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[workshops] calendar sync", w.slug, msg);
    // A stale event id (deleted by hand in Google Calendar): forget it, the next sync creates a new one.
    const gone = e instanceof CalendarError && (e.status === 404 || e.status === 410);
    return db.workshop.update({ where: { id }, data: { googleError: msg.slice(0, 500), ...(gone ? { googleEventId: "" } : {}) } });
  }
}

async function removeCalendarEvent(id: string) {
  const w = await db.workshop.findUnique({ where: { id } });
  if (!w?.googleEventId || !(await calendarConnected())) return;
  try {
    await deleteCalendarEvent(w.googleEventId);
    await db.workshop.update({ where: { id }, data: { googleEventId: "", googleSyncedAt: new Date(), googleError: "" } });
  } catch (e) {
    await db.workshop.update({ where: { id }, data: { googleError: (e instanceof Error ? e.message : String(e)).slice(0, 500) } });
  }
}

/* ---------------------------------------------------------------- email */

function icsFor(w: Workshop, cancelled = false) {
  return Buffer.from(icsText({ uid: `workshop-${w.id}`, title: w.title, summary: w.summary, startsAt: w.startsAt, endsAt: w.endsAt, url: workshopUrl(w.slug), meetUrl: w.meetUrl || undefined, sequence: Math.floor(w.updatedAt.getTime() / 1000) % 100000, cancelled }), "utf8");
}

export async function sendRegistrationEmail(w: Workshop, r: WorkshopRegistration) {
  const when = fmtWhen(w.startsAt, w.endsAt, w.timezone);
  const url = workshopUrl(w.slug);
  const html = templates.workshopConfirmed({ name: r.name || "there", title: w.title, day: when.day, time: when.time, dur: when.dur, host: w.host, meetUrl: w.meetUrl, url, calendarUrl: googleCalendarUrl({ title: w.title, summary: w.summary, startsAt: w.startsAt, endsAt: w.endsAt, url, meetUrl: w.meetUrl || undefined }) });
  return sendEmail({ to: r.email, subject: `You're in: ${w.title} · ${when.day}`, html, kind: "workshop", attachments: [{ filename: "outlly-workshop.ics", content: icsFor(w) }], idempotencyKey: `ws-confirm-${r.id}-${w.updatedAt.getTime()}` });
}

/** Rescheduled or cancelled: one email per registered creator. Google sends its own update too when the calendar is connected. */
export async function notifyRegistered(id: string, change: "rescheduled" | "cancelled") {
  const w = await db.workshop.findUnique({ where: { id }, include: { registrations: { where: { status: "registered" } } } });
  if (!w) return 0;
  const when = fmtWhen(w.startsAt, w.endsAt, w.timezone);
  const url = workshopUrl(w.slug);
  let n = 0;
  for (const r of w.registrations) {
    const html = templates.workshopChanged({ name: r.name || "there", title: w.title, change, day: when.day, time: when.time, url, meetUrl: w.meetUrl });
    const res = await sendEmail({ to: r.email, subject: change === "cancelled" ? `Cancelled: ${w.title}` : `New time: ${w.title} · ${when.day}`, html, kind: "workshop", attachments: [{ filename: "outlly-workshop.ics", content: icsFor(w, change === "cancelled") }], idempotencyKey: `ws-${change}-${r.id}-${w.updatedAt.getTime()}` }).catch(() => null);
    if (res?.ok) n += 1;
  }
  return n;
}

/**
 * Housekeeping sweep: the 24 h reminder (with the Meet link, once per registration) and marking finished sessions
 * completed. Bounded per run; never fatal.
 */
export async function sweepWorkshops(now = new Date()): Promise<{ reminded: number; completed: number }> {
  const soon = new Date(now.getTime() + 24 * 3600_000);
  const due = await db.workshopRegistration.findMany({ where: { status: "registered", reminderAt: null, workshop: { status: "published", startsAt: { gt: now, lte: soon } } }, include: { workshop: true }, take: 100 });
  let reminded = 0;
  for (const r of due) {
    const w = r.workshop;
    const when = fmtWhen(w.startsAt, w.endsAt, w.timezone);
    const html = templates.workshopReminder({ name: r.name || "there", title: w.title, day: when.day, time: when.time, url: workshopUrl(w.slug), meetUrl: w.meetUrl });
    const res = await sendEmail({ to: r.email, subject: `Tomorrow: ${w.title} · ${when.time}`, html, kind: "workshop", idempotencyKey: `ws-remind-${r.id}` }).catch(() => null);
    await db.workshopRegistration.update({ where: { id: r.id }, data: { reminderAt: now } });
    if (res?.ok) reminded += 1;
  }
  const done = await db.workshop.updateMany({ where: { status: "published", endsAt: { lt: new Date(now.getTime() - 15 * 60_000) } }, data: { status: "completed" } });
  return { reminded, completed: done.count };
}
