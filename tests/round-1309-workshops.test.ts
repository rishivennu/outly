/** R1309 Creator Hub workshops + Google Calendar: core helpers, the Google client (fetch mocked), registration rules, sync and route pins. */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fmtWhen, googleCalendarUrl, icsText, outlookCalendarUrl, seatsLabel, slugify, validZone, WorkshopInput, WorkshopPatch } from "../lib/workshops/core";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

let db: typeof import("../lib/db").db;
let ws: typeof import("../lib/workshops/server");
let gcal: typeof import("../lib/google/calendar");
let settings: typeof import("../lib/settings");
let keys: typeof import("../lib/social/keys");

const realFetch = globalThis.fetch;
type Call = { url: string; method: string; body: any };
const calls: Call[] = [];
let googleDown = false;
let eventCounter = 0;
/** A fake Google: token endpoint, calendar insert/patch/delete. Everything else passes through. */
const fakeFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? (typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(String(init.body)))) : null;
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    calls.push({ url, method, body });
    if (body?.grant_type === "authorization_code") return Response.json({ access_token: "at-1", refresh_token: "rt-secret", expires_in: 3600, scope: `openid email ${gcal.CALENDAR_SCOPE}`, id_token: `x.${Buffer.from(JSON.stringify({ email: "Rishi@Outlly.com" })).toString("base64url")}.y` });
    return Response.json({ access_token: "at-refreshed", expires_in: 3600 });
  }
  if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response("", { status: 200 });
  if (url.startsWith("https://www.googleapis.com/calendar/v3/")) {
    calls.push({ url, method, body });
    if (googleDown) return Response.json({ error: { message: "Backend Error" } }, { status: 503 });
    if (method === "DELETE") return new Response(null, { status: 204 });
    eventCounter += 1;
    const id = method === "POST" ? `ev${eventCounter}` : url.split("/events/")[1]!.split("?")[0]!;
    return Response.json({ id, hangoutLink: `https://meet.google.com/abc-${id}`, htmlLink: "https://calendar.google.com/x" });
  }
  return realFetch(input as any, init);
};

const tag = `r1309${Date.now().toString(36)}`;
let n = 0;
const future = (h: number) => new Date(Date.now() + h * 3600_000);
const mk = (over: Record<string, unknown> = {}) => {
  n += 1;
  return db.workshop.create({ data: { slug: `${tag}-${n}`, title: `Workshop ${n}`, summary: "Short pitch", startsAt: future(48), endsAt: future(49), status: "published", publishedAt: new Date(), ...over } });
};

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  ws = await import("../lib/workshops/server");
  gcal = await import("../lib/google/calendar");
  settings = await import("../lib/settings");
  keys = await import("../lib/social/keys");
  globalThis.fetch = fakeFetch;
  process.env.APP_URL ??= "http://localhost:3000";
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await settings.saveConfig("calendar", { google: { refreshToken: "", email: "", calendarId: "primary", connectedAt: "", scope: "" } });
});
afterEach(() => {
  calls.length = 0;
  googleDown = false;
});

describe("core helpers", () => {
  test("slugify, zones, seats", () => {
    expect(slugify("  Reels that Hook: 0–3 s Openers!  ")).toBe("reels-that-hook-0-3-s-openers");
    expect(validZone("Asia/Kolkata")).toBe(true);
    expect(validZone("Mars/Olympus")).toBe(false);
    expect(seatsLabel({ capacity: 0, seatsLeft: null })).toBe("Open seats");
    expect(seatsLabel({ capacity: 10, seatsLeft: 1 })).toBe("1 seat left");
    expect(seatsLabel({ capacity: 10, seatsLeft: 0 })).toBe("Full");
  });
  test("fmtWhen renders in the workshop's zone with IST", () => {
    const w = fmtWhen("2026-12-05T13:30:00.000Z", "2026-12-05T14:30:00.000Z", "Asia/Kolkata");
    expect(w.day).toBe("Sat 5 Dec 2026");
    expect(w.time).toBe("7:00 pm – 8:00 pm IST");
    expect(w.dur).toBe("1 h");
    expect(w.month).toBe("DEC");
    expect(w.dayNum).toBe("5");
  });
  test("calendar links and .ics carry the Meet link, the page and a stable UID", () => {
    const i = { title: "Hooks, live", summary: "Pitch", startsAt: "2026-12-05T13:30:00.000Z", endsAt: "2026-12-05T14:30:00.000Z", url: "https://www.outlly.com/workshops/hooks", meetUrl: "https://meet.google.com/abc-defg-hij" };
    const g = new URL(googleCalendarUrl(i));
    expect(g.searchParams.get("dates")).toBe("20261205T133000Z/20261205T143000Z");
    expect(g.searchParams.get("location")).toBe(i.meetUrl);
    expect(g.searchParams.get("details")).toContain(i.url);
    expect(new URL(outlookCalendarUrl(i)).searchParams.get("subject")).toBe("Hooks, live");
    const ics = icsText({ ...i, uid: "workshop-1" });
    expect(ics).toContain("UID:workshop-1@outlly.com");
    expect(ics).toContain("DTSTART:20261205T133000Z");
    expect(ics).toContain("LOCATION:https://meet.google.com/abc-defg-hij");
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    expect(icsText({ ...i, uid: "w", cancelled: true })).toContain("STATUS:CANCELLED");
  });
  test("WorkshopInput: end after start, under 12 h, patch is partial", () => {
    const base = { title: "Reels that hook", startsAt: "2026-12-05T13:30:00.000Z", endsAt: "2026-12-05T14:30:00.000Z" };
    expect(WorkshopInput.safeParse(base).success).toBe(true);
    expect(WorkshopInput.safeParse({ ...base, endsAt: base.startsAt }).success).toBe(false);
    expect(WorkshopInput.safeParse({ ...base, endsAt: "2026-12-06T13:30:00.000Z" }).success).toBe(false);
    expect(WorkshopInput.safeParse({ ...base, timezone: "Nope/Zone" }).success).toBe(false);
    expect(WorkshopPatch.safeParse({ capacity: 25 }).success).toBe(true);
  });
});

describe("Google Calendar client", () => {
  test("connect URL asks for offline access, consent and the events scope on the shared client", async () => {
    await settings.saveConfig("platforms", { youtube: { clientId: "cid.apps", clientSecret: "sec" } });
    await keys.loadKeys();
    const u = new URL(await gcal.calendarConnectUrl("st4te"));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe("cid.apps");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/calendar.events");
    expect(u.searchParams.get("redirect_uri")).toBe(`${process.env.APP_URL}/api/admin/integrations/google/callback`);
    expect(u.searchParams.get("state")).toBe("st4te");
  });
  test("finishCalendarConnect stores the refresh token (encrypted) and the organiser email", async () => {
    const cfg = await gcal.finishCalendarConnect("c0de");
    expect(cfg.google.refreshToken).toBe("rt-secret");
    expect(cfg.google.email).toBe("rishi@outlly.com");
    const raw = await db.setting.findUnique({ where: { key: "calendar" } });
    expect(raw?.value).not.toContain("rt-secret");
    expect(settings.redact("calendar", cfg).google.refreshToken).not.toBe("rt-secret");
    const st = await gcal.calendarStatus();
    expect(st.connected).toBe(true);
    expect(st.email).toBe("rishi@outlly.com");
  });
  test("createCalendarEvent: Meet room, guests hidden from each other, sendUpdates=all; patch keeps the room", async () => {
    gcal.__resetCalendarTokens();
    const ev = await gcal.createCalendarEvent({ key: "k1", title: "T", description: "D", startsAt: new Date("2026-12-05T13:30:00Z"), endsAt: new Date("2026-12-05T14:30:00Z"), timezone: "Asia/Kolkata", url: "https://x/y", attendees: [{ email: "a@b.c", name: "A" }] });
    expect(ev.meetUrl).toMatch(/^https:\/\/meet\.google\.com\//);
    const post = calls.find((c) => c.method === "POST" && c.url.includes("/calendar/"))!;
    const u = new URL(post.url);
    expect(u.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(u.searchParams.get("sendUpdates")).toBe("all");
    expect(post.body.conferenceData.createRequest.requestId).toBe("k1");
    expect(post.body.guestsCanSeeOtherGuests).toBe(false);
    expect(post.body.attendees).toEqual([{ email: "a@b.c", displayName: "A" }]);
    expect(post.body.start.timeZone).toBe("Asia/Kolkata");
    expect(calls.some((c) => c.body?.grant_type === "refresh_token")).toBe(true);
    const up = await gcal.updateCalendarEvent(ev.id, { key: "k1", title: "T2", description: "", startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000), timezone: "UTC", url: "https://x", attendees: [] });
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.body.conferenceData).toBeUndefined();
    expect(up.id).toBe(ev.id);
    await gcal.deleteCalendarEvent(ev.id);
    expect(new URL(calls.find((c) => c.method === "DELETE")!.url).searchParams.get("sendUpdates")).toBe("all");
  });
});

describe("registrations and calendar sync", () => {
  test("register: one seat per email, idempotent, capacity enforced, Meet link only for the registered", async () => {
    const w = await mk({ capacity: 2 });
    const a = await ws.registerForWorkshop(w.slug, { email: "Ria@Example.com", name: "Ria", id: null });
    expect(a.created).toBe(true);
    expect(a.registration.email).toBe("ria@example.com");
    const again = await ws.registerForWorkshop(w.slug, { email: "ria@example.com", name: "Ria" });
    expect(again.created).toBe(false);
    await ws.registerForWorkshop(w.slug, { email: "two@example.com" });
    await expect(ws.registerForWorkshop(w.slug, { email: "three@example.com" })).rejects.toMatchObject({ status: 409, code: "FULL" });
    const synced = await db.workshop.findUniqueOrThrow({ where: { id: w.id } });
    expect(synced.googleEventId).toMatch(/^ev/);
    expect(synced.meetUrl).toContain("meet.google.com");
    // Google got the guest list on each change, and the invite went out with sendUpdates=all
    const patches = calls.filter((c) => c.method === "PATCH" || c.method === "POST");
    expect(patches.length).toBeGreaterThanOrEqual(2);
    expect(patches.at(-1)!.body.attendees.map((x: any) => x.email).sort()).toEqual(["ria@example.com", "two@example.com"]);
    const anon = await ws.getWorkshop(w.slug, null);
    expect(anon?.meetUrl).toBeUndefined();
    expect(anon?.registered).toBe(2);
    expect(anon?.seatsLeft).toBe(0);
    const ria = await ws.getWorkshop(w.slug, { id: "x", email: "ria@example.com" });
    expect(ria?.meetUrl).toContain("meet.google.com");
    expect(ria?.mine?.status).toBe("registered");
    // our confirmation email went to the Outbox with the .ics
    const mail = await db.emailLog.findFirst({ where: { to: "ria@example.com", kind: "workshop" }, orderBy: { createdAt: "desc" } });
    expect(mail?.subject).toMatch(/^You're in: Workshop/);
    expect(mail?.html).toContain("meet.google.com");
    // giving the seat back frees it and drops the guest
    await ws.cancelRegistration(w.slug, "two@example.com");
    expect((await ws.getWorkshop(w.slug, null))?.seatsLeft).toBe(1);
    expect(calls.filter((c) => c.method === "PATCH").at(-1)!.body.attendees.map((x: any) => x.email)).toEqual(["ria@example.com"]);
  });
  test("closed workshops refuse registrations", async () => {
    const cancelled = await mk({ status: "cancelled" });
    await expect(ws.registerForWorkshop(cancelled.slug, { email: "a@b.co" })).rejects.toMatchObject({ code: "CANCELLED" });
    const ended = await mk({ startsAt: new Date(Date.now() - 7200_000), endsAt: new Date(Date.now() - 3600_000) });
    await expect(ws.registerForWorkshop(ended.slug, { email: "a@b.co" })).rejects.toMatchObject({ code: "ENDED" });
    const draft = await mk({ status: "draft" });
    await expect(ws.registerForWorkshop(draft.slug, { email: "a@b.co" })).rejects.toMatchObject({ status: 404 });
    expect(await ws.getWorkshop(draft.slug)).toBeNull();
  });
  test("a Google failure never blocks the seat; the error is kept on the row and cleared by a later sync", async () => {
    const w = await mk();
    googleDown = true;
    const r = await ws.registerForWorkshop(w.slug, { email: "ok@example.com" });
    expect(r.created).toBe(true);
    let row = await db.workshop.findUniqueOrThrow({ where: { id: w.id } });
    expect(row.googleError).toContain("Backend Error");
    expect(row.googleEventId).toBe("");
    googleDown = false;
    await ws.syncWorkshopCalendar(w.id);
    row = await db.workshop.findUniqueOrThrow({ where: { id: w.id } });
    expect(row.googleError).toBe("");
    expect(row.googleEventId).toMatch(/^ev/);
  });
  test("admin: create as draft (no Google), publish syncs, reschedule emails + patches, cancel deletes the event and emails", async () => {
    const admin = { name: "Tester", login: "tester" };
    const input = WorkshopInput.parse({ title: `Draft ${tag}`, startsAt: future(72).toISOString(), endsAt: future(73).toISOString(), summary: "S" });
    const d = await ws.createWorkshop(input, admin);
    expect(d.status).toBe("draft");
    expect(d.slug).toBe(`draft-${tag}`);
    expect(calls.filter((c) => c.url.includes("/calendar/")).length).toBe(0);
    const dup = await ws.createWorkshop(input, admin);
    expect(dup.slug).toBe(`draft-${tag}-2`);
    await ws.deleteWorkshop(dup.id, admin);
    await db.workshopRegistration.create({ data: { workshopId: d.id, email: "guest@example.com", name: "Guest" } });
    const p = await ws.setWorkshopStatus(d.id, "published", admin);
    expect(p.googleEventId).toMatch(/^ev/);
    expect(p.meetUrl).toContain("meet.google.com");
    expect(p.publishedAt).not.toBeNull();
    await expect(ws.deleteWorkshop(d.id, admin)).rejects.toMatchObject({ status: 409 });
    calls.length = 0;
    const moved = await ws.updateWorkshop(d.id, { startsAt: future(96).toISOString(), endsAt: future(97).toISOString() }, admin);
    expect(moved.startsAt.getTime()).toBeGreaterThan(p.startsAt.getTime());
    expect(calls.some((c) => c.method === "PATCH")).toBe(true);
    const resched = await db.emailLog.findFirst({ where: { to: "guest@example.com", subject: { startsWith: "New time:" } } });
    expect(resched).not.toBeNull();
    calls.length = 0;
    const c = await ws.setWorkshopStatus(d.id, "cancelled", admin);
    expect(c.googleEventId).toBe("");
    expect(calls.some((x) => x.method === "DELETE")).toBe(true);
    const cm = await db.emailLog.findFirst({ where: { to: "guest@example.com", subject: { startsWith: "Cancelled:" } } });
    expect(cm?.html).toContain("cancelled");
    expect((await ws.getWorkshop(d.slug))?.status).toBe("cancelled"); // the page still explains itself
    expect((await ws.listPublicWorkshops()).upcoming.some((x) => x.id === d.id)).toBe(false); // but leaves the list
    const list = await ws.listAdminWorkshops();
    expect(list.find((x) => x.id === d.id)?.status).toBe("cancelled");
  });
  test("sweep: 24 h reminder once per seat, finished sessions become completed", async () => {
    const soon = await mk({ startsAt: future(20), endsAt: future(21) });
    await db.workshopRegistration.create({ data: { workshopId: soon.id, email: "soon@example.com" } });
    const far = await mk({ startsAt: future(60), endsAt: future(61) });
    await db.workshopRegistration.create({ data: { workshopId: far.id, email: "far@example.com" } });
    const over = await mk({ startsAt: new Date(Date.now() - 3 * 3600_000), endsAt: new Date(Date.now() - 2 * 3600_000) });
    const r1 = await ws.sweepWorkshops();
    expect(r1.reminded).toBe(1);
    expect(r1.completed).toBeGreaterThanOrEqual(1);
    expect((await db.workshop.findUniqueOrThrow({ where: { id: over.id } })).status).toBe("completed");
    const mail = await db.emailLog.findFirst({ where: { to: "soon@example.com" } });
    expect(mail?.subject).toMatch(/^Tomorrow:/);
    const r2 = await ws.sweepWorkshops();
    expect(r2.reminded).toBe(0);
    const pub = await ws.listPublicWorkshops();
    expect(pub.upcoming.some((w) => w.id === soon.id)).toBe(true);
    expect(pub.upcoming.some((w) => w.id === over.id)).toBe(false);
  });
});

describe("source pins", () => {
  test("routes: admin area, same-origin wrappers, Google callback checks state, ics hides Meet from strangers", () => {
    expect(read("app/api/admin/workshops/route.ts")).toContain('adminRoute("workshops"');
    expect(read("app/api/admin/workshops/[id]/route.ts")).toContain("resync");
    const cb = read("app/api/admin/integrations/google/callback/route.ts");
    expect(cb).toContain("safeEqual(expected, state)");
    expect(cb).toContain('can(admin.role, "integrations")');
    expect(read("app/api/admin/integrations/google/route.ts")).toContain('adminRoute("integrations"');
    expect(read("lib/google/calendar.ts")).toContain('u.searchParams.set("prompt", "consent")');
    expect(read("app/api/workshops/[slug]/register/route.ts")).toContain("route<Ctx>(");
    expect(read("app/api/workshops/[slug]/ics/route.ts")).toContain('mine?.status === "registered"');
    expect(read("lib/admin/perms.ts")).toMatch(/workshops: \["super", "marketing", "support"\]/);
    expect(read("components/admin/AdminShell.tsx")).toContain('href: "/admin/workshops"');
    const mw = read("middleware.ts");
    expect(mw).toMatch(/const OPEN = \[[^\]]*"\/workshops"/);
    expect(mw).toMatch(/const WAITLIST_PREFIX = \[[^\]]*"\/workshops\/"/);
    expect(read("app/api/cron/sweep/route.ts")).toContain("sweepWorkshops(now)");
    expect(read("lib/settings.ts")).toContain('calendar: ["google.refreshToken"]');
    for (const f of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) {
      const s = read(f);
      expect(s).toContain("model Workshop {");
      expect(s).toContain("@@unique([workshopId, email])");
    }
  });
});
