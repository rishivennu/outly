import { z } from "zod";

/**
 * R1309 Creator Hub workshops: the client-safe half. Types, the admin form schema, time formatting in the
 * workshop's own zone, the "Add to calendar" links and the .ics text. No database, no secrets (lib/workshops/server.ts).
 */
export const WORKSHOP_STATUSES = ["draft", "published", "cancelled", "completed"] as const;
export type WorkshopStatus = (typeof WORKSHOP_STATUSES)[number];
export const WORKSHOP_LEVELS = ["all", "beginner", "intermediate", "advanced"] as const;
export type WorkshopLevel = (typeof WORKSHOP_LEVELS)[number];
export const LEVEL_LABEL: Record<WorkshopLevel, string> = { all: "All levels", beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };
export const STATUS_LABEL: Record<WorkshopStatus, string> = { draft: "Draft", published: "Published", cancelled: "Cancelled", completed: "Completed" };

/** What the public pages and the admin table render. Dates are ISO strings so the object survives the RSC boundary. */
export interface WorkshopView {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  host: string;
  level: WorkshopLevel;
  tags: string[];
  startsAt: string;
  endsAt: string;
  timezone: string;
  capacity: number;
  status: WorkshopStatus;
  coverUrl: string;
  recordingUrl: string;
  /** Only present when the viewer is registered (or an admin): the Meet link is for guests. */
  meetUrl?: string;
  registered: number;
  /** null = unlimited. */
  seatsLeft: number | null;
  /** The session has ended (by the clock), whatever the status says. */
  past: boolean;
  /** Live right now. */
  live: boolean;
  /** The viewer's registration, when signed in. */
  mine?: { status: string; createdAt: string } | null;
  googleEventId?: string;
  googleError?: string;
  googleSyncedAt?: string | null;
  publishedAt?: string | null;
  cancelledAt?: string | null;
  createdAt?: string;
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const IANA = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$|^UTC$/;
export const validZone = (tz: string) => {
  if (!IANA.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Admin create/update body. Times arrive as ISO strings (the form builds them from date + time + zone). */
const WorkshopFields = z.object({
    title: z.string().trim().min(3, "Give the workshop a title (3+ characters).").max(120),
    slug: z.string().trim().max(80).regex(/^[a-z0-9-]*$/, "Slugs are lowercase letters, numbers and dashes.").optional(),
    summary: z.string().trim().max(200).default(""),
    description: z.string().trim().max(8000).default(""),
    host: z.string().trim().max(80).default(""),
    level: z.enum(WORKSHOP_LEVELS).default("all"),
    tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    timezone: z.string().trim().refine(validZone, "Use an IANA time zone like Asia/Kolkata.").default("Asia/Kolkata"),
    capacity: z.number().int().min(0).max(100_000).default(0),
    coverUrl: z.union([z.literal(""), z.string().trim().url().max(500)]).default(""),
    meetUrl: z.union([z.literal(""), z.string().trim().url().max(500)]).default(""),
    recordingUrl: z.union([z.literal(""), z.string().trim().url().max(500)]).default(""),
});
export const WorkshopInput = WorkshopFields
  .refine((v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(), { message: "The workshop has to end after it starts.", path: ["endsAt"] })
  .refine((v) => new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime() <= 12 * 3600_000, { message: "Keep a session under 12 hours.", path: ["endsAt"] });
export type WorkshopInputT = z.infer<typeof WorkshopInput>;
export const WorkshopPatch = WorkshopFields.partial();

export const durationMin = (a: string | Date, b: string | Date) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));

const zoneAbbr = (d: Date, tz: string) => {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? tz;
    // "GMT+5:30" reads worse than "IST"; Intl gives IST for Asia/Kolkata in en-IN but GMT+5:30 in en-GB.
    return part.startsWith("GMT+5:30") || part === "GMT+05:30" ? "IST" : part;
  } catch {
    return tz;
  }
};

/** "Sat 6 Dec 2026" / "7:00 – 8:00 pm IST" / "60 min", in the workshop's zone (same output on server and client). */
export function fmtWhen(startsAt: string | Date, endsAt: string | Date, tz: string) {
  const s = new Date(startsAt), e = new Date(endsAt);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(s).replace(",", "");
  const t = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(/\s?(am|pm)/i, (_m, ap: string) => ` ${ap.toLowerCase()}`);
  const time = `${t(s)} – ${t(e)} ${zoneAbbr(s, tz)}`;
  const mins = durationMin(s, e);
  const dur = mins >= 60 ? (mins % 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins / 60} h`) : `${mins} min`;
  const month = new Intl.DateTimeFormat("en-GB", { timeZone: tz, month: "short" }).format(s).toUpperCase();
  const dayNum = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric" }).format(s);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(s);
  return { day, time, dur, month, dayNum, weekday };
}

const stamp = (d: string | Date) => new Date(d).toISOString().replace(/[-:]|\.\d{3}/g, ""); // 20261206T133000Z

export interface CalendarLinkInput {
  title: string;
  summary: string;
  startsAt: string | Date;
  endsAt: string | Date;
  /** The workshop page (details and the Meet link live there). */
  url: string;
  meetUrl?: string;
}

const details = (i: CalendarLinkInput) => [i.summary, i.meetUrl ? `Join: ${i.meetUrl}` : "", `Details: ${i.url}`].filter(Boolean).join("\n\n");

/** Google Calendar "template" link: works for everyone, signed in to Outlly or not; no API needed. */
export function googleCalendarUrl(i: CalendarLinkInput) {
  const u = new URL("https://calendar.google.com/calendar/render");
  u.searchParams.set("action", "TEMPLATE");
  u.searchParams.set("text", i.title);
  u.searchParams.set("dates", `${stamp(i.startsAt)}/${stamp(i.endsAt)}`);
  u.searchParams.set("details", details(i));
  if (i.meetUrl) u.searchParams.set("location", i.meetUrl);
  return u.toString();
}

export function outlookCalendarUrl(i: CalendarLinkInput) {
  const u = new URL("https://outlook.live.com/calendar/0/action/compose");
  u.searchParams.set("rru", "addevent");
  u.searchParams.set("subject", i.title);
  u.searchParams.set("startdt", new Date(i.startsAt).toISOString());
  u.searchParams.set("enddt", new Date(i.endsAt).toISOString());
  u.searchParams.set("body", details(i));
  if (i.meetUrl) u.searchParams.set("location", i.meetUrl);
  return u.toString();
}

const icsEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** RFC 5545 folds lines at 75 octets; we fold at 70 characters to stay under it with multi-byte text. */
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 70) {
    out.push(rest.slice(0, 70));
    rest = " " + rest.slice(70);
  }
  out.push(rest);
  return out.join("\r\n");
};

/** An .ics file (Apple Calendar, Outlook desktop, Thunderbird). UID is stable per workshop so re-downloads update, not duplicate. */
export function icsText(i: CalendarLinkInput & { uid: string; organizerEmail?: string; sequence?: number; cancelled?: boolean }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Outlly//Workshops//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${i.cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${i.uid}@outlly.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(i.startsAt)}`,
    `DTEND:${stamp(i.endsAt)}`,
    `SEQUENCE:${i.sequence ?? 0}`,
    `STATUS:${i.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    `SUMMARY:${icsEsc(i.title)}`,
    `DESCRIPTION:${icsEsc(details(i))}`,
    `URL:${i.url}`,
    ...(i.meetUrl ? [`LOCATION:${icsEsc(i.meetUrl)}`] : []),
    ...(i.organizerEmail ? [`ORGANIZER;CN=Outlly:mailto:${i.organizerEmail}`] : []),
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEsc(i.title)} starts in 30 minutes`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Seats copy for cards: "12 seats left", "Full", "Open seats". */
export function seatsLabel(w: Pick<WorkshopView, "capacity" | "seatsLeft">) {
  if (!w.capacity) return "Open seats";
  if ((w.seatsLeft ?? 0) <= 0) return "Full";
  return `${w.seatsLeft} ${w.seatsLeft === 1 ? "seat" : "seats"} left`;
}

export const parseTags = (raw: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
};
