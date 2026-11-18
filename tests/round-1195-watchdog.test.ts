/**
 * Round 1195: the Outlly Watchdog.
 * - Pure rules: redaction, due-ness, escalation, the alert wording and its link.
 * - The engine with an injected fetch: dashboard API down -> critical incident + alert; repeats are grouped (one
 *   incident, one alert); recovery needs two passing checks and sends exactly one recovery alert; a warning that
 *   persists escalates once; a critical gets a reminder after 30 min; cooldown stops a flapping service from
 *   re-alerting; muted services are recorded but never alerted.
 * - Real data probes: publishing failing (seeded PostTarget rows), uploads failing (UploadSession rows), publishing
 *   delayed (overdue posts), the sweep worker stopping, external platform APIs unreachable.
 * - The independent heartbeat monitor opens the "watchdog" incident when the cycle record goes stale and closes it
 *   again, on its own, through the cron route with the CRON_SECRET bearer.
 * - Alert delivery: push to a super admin's alert device from the server (no session, no page), recorded with the
 *   push service's real answer; when the push is refused the critical goes to the configured email and that is
 *   recorded too; nothing is ever marked sent without an accepting channel.
 * - Admin API: overview for a support admin, run-now and settings super-only, ack never resolves, resolve writes
 *   who, reopen, notes in the trail, CSV export, alert device enrolment, and the test alert.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (n: string) => jar.has(n),
  set: (n: string | { name: string; value: string }, v?: string, o?: Record<string, unknown>) => {
    if (typeof n === "object") {
      const { name, value, ...rest } = n as { name: string; value: string };
      jar.set(name, { value, opts: rest });
    } else jar.set(n, { value: v ?? "", opts: o ?? {} });
  },
  delete: (n: string | { name: string }) => jar.delete(typeof n === "object" ? n.name : n),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

// The two outbound channels, replaced at the edge: what the push service / email provider "answered" is scripted
// per test, and every call is recorded so the tests can check what left.
type PushOutcome = "sent" | "gone" | "retry" | "rejected";
const pushScript = { outcome: "sent" as PushOutcome, calls: [] as { payload: Record<string, unknown>; tag: string; urgency: string }[] };
process.env.CRON_SECRET = "r1195-cron-secret";
process.env.APP_URL = "http://localhost:3000";
// In the full suite lib/env was parsed by an earlier file, and bun's mock.module is run-wide: the env object is set
// directly (and restored), and every replacement below hands the call to the real function once this file is done.
const { env } = await import("../lib/env");
const savedEnv = { CRON_SECRET: env.CRON_SECRET, APP_URL: env.APP_URL };
env.CRON_SECRET = "r1195-cron-secret";
env.APP_URL = "http://localhost:3000";
type AdminSession = import("../lib/admin/auth").AdminSession;
const g = globalThis as typeof globalThis & { __r1195Active?: boolean; __r1195Admin?: AdminSession | null };
g.__r1195Active = true;
g.__r1195Admin = null;
const realAuth = await import("../lib/admin/auth");
const realGetAdmin = realAuth.getAdmin;
mock.module("../lib/admin/auth", () => ({ ...realAuth, getAdmin: async () => (g.__r1195Admin !== undefined ? g.__r1195Admin : realGetAdmin()) }));
const realPush = await import("../lib/push/webpush");
const realPushToSub = realPush.pushToSub;
mock.module("../lib/push/webpush", () => ({
  ...realPush,
  pushToSub: async (...a: Parameters<typeof realPushToSub>) => {
    if (!g.__r1195Active) return realPushToSub(...a);
    const [, payload, , urgency, tag] = a;
    pushScript.calls.push({ payload: JSON.parse(payload), tag, urgency });
    return { outcome: pushScript.outcome, status: pushScript.outcome === "sent" ? 201 : pushScript.outcome === "gone" ? 410 : pushScript.outcome === "rejected" ? 400 : null };
  },
}));
const emailScript = { ok: true, status: "sent", calls: [] as { to: string; kind: string; subject: string; text?: string }[] };
const realEmail = await import("../lib/email");
const realSendEmail = realEmail.sendEmail;
mock.module("../lib/email", () => ({
  ...realEmail,
  sendEmail: async (...a: Parameters<typeof realSendEmail>) => {
    if (!g.__r1195Active) return realSendEmail(...a);
    const m = a[0] as { to: string; kind: string; subject: string; text?: string };
    emailScript.calls.push(m);
    return { ok: emailScript.ok, status: emailScript.status, id: "e1", ...(emailScript.ok ? {} : { error: "provider refused" }) };
  },
}));

const { db } = await import("../lib/db");
const { invalidate } = await import("../lib/cache");
const adminAuth = await import("../lib/admin/auth");
const core = await import("../lib/health/core");
const registry = await import("../lib/health/registry");
const engine = await import("../lib/health/engine");
const { saveWatchdogConfig } = await import("../lib/health/config");
const { recordSweep } = await import("../lib/queue/health");
const { vapidKeys } = await import("../lib/push/vapid");
const healthRoute = await import("../app/api/admin/health/route");
const incidentsRoute = await import("../app/api/admin/health/incidents/route");
const incidentRoute = await import("../app/api/admin/health/incidents/[id]/route");
const devicesRoute = await import("../app/api/admin/health/devices/route");
const cronHealth = await import("../app/api/cron/health/route");

const ORIGIN = "http://localhost:3000";
const H = { "content-type": "application/json", origin: ORIGIN, host: "localhost:3000" };
type Handler = (req: NextRequest, ctx: never) => Promise<Response>;
const ctxOf = (path: string) => {
  const m = path.match(/\/incidents\/([^/?]+)/);
  return { params: Promise.resolve(m ? { id: decodeURIComponent(m[1]) } : {}) } as never;
};
const req = (h: Handler, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => h(new NextRequest(`${ORIGIN}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { ...H, ...headers } }), ctxOf(path));
const GET = (h: Handler, path: string, headers?: Record<string, string>) => req(h, "GET", path, undefined, headers);
const POST = (h: Handler, path: string, body: unknown) => req(h, "POST", path, body);
const PATCH = (h: Handler, path: string, body: unknown) => req(h, "PATCH", path, body);
const DEL = (h: Handler, path: string, body: unknown) => req(h, "DELETE", path, body);
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const admins: string[] = [];
const users: string[] = [];
const mkAdmin = async (role: "super" | "support", name = `WD ${role}`) => {
  const row = await db.adminUser.create({ data: { login: `wd1195-${role}-${tag()}`, name, role, passwordHash: `x-${tag()}` } });
  admins.push(row.id);
  return row;
};
const signOut = () => {
  jar.clear();
  g.__r1195Admin = null;
};
const asAdmin = async (a: { id: string; name: string; login: string; role: string; passwordHash: string }) => {
  signOut();
  await adminAuth.createAdminSession(a);
  g.__r1195Admin = { id: a.id, name: a.name, login: a.login, role: a.role as AdminSession["role"] };
};
const mkUser = async () => {
  const email = `wd1195-${tag()}@test.dev`;
  const u = await db.user.create({ data: { name: "WD user", email, passwordHash: "x", emailVerifiedAt: new Date(), emailVerifiedFor: email } });
  users.push(u.id);
  const media = await db.media.create({ data: { userId: u.id, originalFilename: "a.mp4", storageKey: `wd/${tag()}.mp4`, mimeType: "video/mp4", size: 10 } });
  return { u, media };
};

const okFetch: typeof fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/api/me")) return new Response("{}", { status: 401 });
  return new Response("ok", { status: 200 });
};
const apiDown: typeof fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/api/health")) return new Response("boom", { status: 500 });
  return okFetch(input);
};
const netDown: typeof fetch = async () => {
  throw new TypeError("fetch failed: getaddrinfo ENOTFOUND");
};
const T0 = new Date("2026-11-18T10:00:00.000Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const run = (fetchImpl: typeof fetch, only: string[], now: Date, extra: Partial<Parameters<typeof engine.runHealthCycle>[0]> = {}) => engine.runHealthCycle({ origin: ORIGIN, fetch: fetchImpl, only, now, force: true, source: "test", ...extra });
const openFor = (service: string) => db.healthIncident.findFirst({ where: { service, status: { not: "resolved" } }, orderBy: { firstDetectedAt: "desc" } });
const deliveries = (incidentId: string) => db.healthAlertDelivery.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" } });
const wipe = async () => {
  await db.healthAlertDelivery.deleteMany({});
  await db.healthIncidentNote.deleteMany({});
  await db.healthIncident.deleteMany({});
  await db.healthCheck.deleteMany({});
  await db.adminEvent.deleteMany({ where: { kind: { startsWith: "watchdog_" } } });
  pushScript.calls = [];
  pushScript.outcome = "sent";
  emailScript.calls = [];
  emailScript.ok = true;
  emailScript.status = "sent";
  await saveWatchdogConfig({ enabled: true, intervals: {}, alertEmail: "", muted: [] });
  invalidate("watchdog:config");
};

beforeEach(signOut);
afterAll(async () => {
  signOut();
  await wipe();
  g.__r1195Active = false;
  g.__r1195Admin = undefined;
  env.CRON_SECRET = savedEnv.CRON_SECRET;
  env.APP_URL = savedEnv.APP_URL;
  await db.adminPushSub.deleteMany({ where: { adminId: { in: admins } } });
  await db.setting.deleteMany({ where: { key: { in: [engine.LAST_CYCLE_KEY, engine.HEARTBEAT_KEY, "watchdog:config", "sweeper:last:inproc", "sweeper:last:cron"] } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.adminUser.deleteMany({ where: { id: { in: admins } } });
});

describe("pure rules", () => {
  test("redact strips secrets, tokens, emails, ips and long hex", () => {
    const s = core.redact("postgres://user:Secr3tPass@db.host/x key=abcdef12345 Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-abcdefghijk ops@example.com from 10.0.0.1 id 0123456789abcdef0123456789abcdef");
    expect(s).not.toContain("Secr3tPass");
    expect(s).not.toContain("abcdef12345");
    expect(s).not.toContain("eyJhbGci");
    expect(s).not.toContain("ops@example.com");
    expect(s).toContain("<email>");
    expect(s).toContain("<ip>");
    expect(s).toContain("<hex>");
    expect(core.redact("x".repeat(500), 100).length).toBeLessThanOrEqual(100);
    expect(core.redact(new Error("Boom"))).toBe("Error: Boom");
  });
  test("isDue follows the service interval, and a never-checked service is always due", () => {
    const svc = registry.MONITORED.find((s) => s.id === "db")!;
    const now = T0.getTime();
    expect(core.isDue(svc, null, now)).toBe(true);
    expect(core.isDue(svc, now - 10_000, now)).toBe(false);
    expect(core.isDue(svc, now - (svc.intervalSec + 1) * 1000, now)).toBe(true);
    expect(core.isDue(svc, now - 100_000, now, 300)).toBe(false);
  });
  test("warnings escalate after 30 min or 10 repeats; criticals get reminders every 30 min after the first alert", () => {
    const base = { severity: "warning", firstDetectedAt: T0, occurrences: 1, status: "open" };
    expect(core.shouldEscalate(base, at(29).getTime())).toBe(false);
    expect(core.shouldEscalate(base, at(30).getTime())).toBe(true);
    expect(core.shouldEscalate({ ...base, occurrences: 10 }, at(1).getTime())).toBe(true);
    expect(core.shouldEscalate({ ...base, status: "resolved" }, at(60).getTime())).toBe(false);
    expect(core.shouldEscalate({ ...base, severity: "critical" }, at(60).getTime())).toBe(false);
    const crit = { severity: "critical", status: "open", notifiedAt: T0, lastReminderAt: null };
    expect(core.reminderDue(crit, at(29).getTime())).toBe(false);
    expect(core.reminderDue(crit, at(30).getTime())).toBe(true);
    expect(core.reminderDue({ ...crit, lastReminderAt: at(30) }, at(59).getTime())).toBe(false);
    expect(core.reminderDue({ ...crit, notifiedAt: null }, at(60).getTime())).toBe(false);
  });
  test("alertText uses the brief's wording and links to the incident", () => {
    const inc = { id: "inc1", service: "db", severity: "critical", title: "Database connectivity has failed", description: "Database did not answer", firstDetectedAt: T0, occurrences: 3 };
    const t = core.alertText("critical", inc, "Database");
    expect(t.title).toBe("Outlly Watchdog, Critical");
    expect(t.body.split("\n")).toEqual(["Database connectivity has failed", "Affected service: Database", "Detected: 2026-11-18 10:00 UTC (3 failed checks grouped)", "Database did not answer", "Action: Open System Health"]);
    expect(t.href).toBe("/admin/health?incident=inc1");
    expect(t.tag).toBe("watchdog:inc1");
    expect(core.alertText("warning", { ...inc, severity: "warning" }, "Database").title).toBe("Outlly Watchdog, Warning");
    const r = core.alertText("recovery", { ...inc, resolvedAt: at(12) }, "Database");
    expect(r.title).toBe("Outlly Watchdog, Recovered");
    expect(r.body).toContain("has recovered");
    expect(r.body).toContain("after 12 min");
  });
  test("summarize: critical beats warning beats ok; nothing checked is unknown", () => {
    expect(core.summarize([], 0, 0).overall).toBe("unknown");
    expect(core.summarize(["ok", "ok"], 0, 0).overall).toBe("ok");
    expect(core.summarize(["ok", "warning"], 0, 1).overall).toBe("warning");
    expect(core.summarize(["ok", "warning", "critical"], 1, 1)).toEqual({ overall: "critical", counts: { ok: 1, warning: 1, critical: 1, unknown: 0 }, openCritical: 1, openWarnings: 1 });
  });
  test("the registry covers the brief's groups and says why a service is not monitored", () => {
    for (const g of ["Core", "Studio", "Publishing", "Creator", "AI", "Admin"]) expect(registry.SERVICES.some((s) => s.group === g && s.monitored)).toBe(true);
    for (const s of registry.SERVICES) if (!s.monitored) expect(s.why.length).toBeGreaterThan(10);
    expect(new Set(registry.SERVICES.map((s) => s.id)).size).toBe(registry.SERVICES.length);
    for (const s of registry.MONITORED) expect(s.intervalSec).toBeGreaterThanOrEqual(60);
  });
});

const checks = await import("../lib/health/checks");
const sig = (rows: { kind: string; channel: string; status: string }[]) => rows.map((x) => `${x.kind}/${x.channel}/${x.status}`).sort();
const mkDevice = async (adminId: string) => db.adminPushSub.create({ data: { adminId, endpointHash: `h-${tag()}`, endpoint: "https://fcm.googleapis.com/fcm/send/test", p256dh: "p", auth: "a", vapidKey: (await vapidKeys()).publicKey, platform: "desktop", device: "Test", client: "Bun" } });
const clearDevices = () => db.adminPushSub.deleteMany({ where: { adminId: { in: admins } } });
const mkMedia = (userId: string) => db.media.create({ data: { userId, originalFilename: "b.mp4", storageKey: `wd/${tag()}.mp4`, mimeType: "video/mp4", size: 10 } });
const setConfig = async (patch: Partial<{ enabled: boolean; intervals: Record<string, number>; alertEmail: string; muted: string[] }>) => {
  await saveWatchdogConfig({ enabled: true, intervals: {}, alertEmail: "", muted: [], ...patch });
  invalidate("watchdog:config");
};
// Real wall clock: alert rows carry a database `createdAt`, so cooldown and reminder windows must be measured
// against the same clock the rows get.
const N0 = new Date();
const N = (min: number) => new Date(N0.getTime() + min * 60_000);
/**
 * The real-data probes count every row in a time window, and the shared test database carries rows left by earlier
 * files. Move what is already there out of the windows (older, or not due yet) so the counts below are this file's.
 */
const ageOut = async () => {
  const old = N(-180);
  await db.uploadSession.updateMany({ where: { updatedAt: { gte: N(-70) } }, data: { updatedAt: old } });
  await db.uploadSession.updateMany({ where: { status: "finalizing" }, data: { updatedAt: N0 } });
  await db.uploadSession.updateMany({ where: { status: "uploading", expiresAt: { lt: N(10) } }, data: { expiresAt: N(600) } });
  await db.post.updateMany({ where: { status: "scheduled", requireApproval: false, scheduledAt: { lt: N(10) } }, data: { scheduledAt: N(600) } });
  await db.postTarget.updateMany({ where: { platformStatus: { in: ["queued", "uploading", "processing"] }, practice: false }, data: { updatedAt: N0, attempts: 0 } });
  await db.postTarget.updateMany({ where: { platform: "instagram", practice: false, platformStatus: { in: ["published", "failed"] }, updatedAt: { gte: N(-25 * 60) } }, data: { updatedAt: N(-26 * 60) } });
};
const authDown: typeof fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/api/me")) return new Response("x", { status: 500 });
  return okFetch(input);
};
const dbDownApi: typeof fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/api/health")) return new Response("db", { status: 503 });
  return okFetch(input);
};
const ctx = (over: Partial<Parameters<typeof checks.runCheck>[1]> = {}) => ({ now: N0, origin: ORIGIN, fetch: okFetch, deadlineMs: 9_000, ...over });

describe("engine: dashboard API down", () => {
  let sup: { id: string };
  let incId = "";
  beforeAll(async () => {
    await wipe();
    await clearDevices();
    sup = await mkAdmin("super");
    await mkDevice(sup.id);
  });
  test("opens one critical incident and pushes to the super admin's device from the server, with no session or page", async () => {
    expect(jar.size).toBe(0);
    const s = await run(apiDown, ["app"], N0);
    expect(s.ran).toEqual(["app"]);
    expect(s.opened).toEqual(["app"]);
    const inc = (await openFor("app"))!;
    incId = inc.id;
    expect(inc.severity).toBe("critical");
    expect(inc.title).toBe("App & API has failed");
    expect(inc.description).toContain("/api/health answered 500");
    expect(inc.likelyCause).toContain("(estimated)");
    expect(inc.occurrences).toBe(1);
    expect(inc.notifiedAt?.getTime()).toBe(N0.getTime());
    const d = await deliveries(inc.id);
    expect(sig(d)).toEqual(["critical/bell/sent", "critical/push/sent"]);
    expect(d.find((x) => x.channel === "push")?.adminId).toBe(sup.id);
    expect(pushScript.calls).toHaveLength(1);
    const p = pushScript.calls[0];
    expect(p.payload.t).toBe("Outlly Watchdog, Critical");
    expect(p.payload.h).toBe(`/admin/health?incident=${inc.id}`);
    expect(p.payload.g).toBe(`watchdog:${inc.id}`);
    expect(p.payload.q).toBe(1);
    expect(p.urgency).toBe("high");
    expect(String(p.payload.b)).toContain("App & API has failed");
    expect(String(p.payload.b)).toContain("Affected service: App & API");
    expect(String(p.payload.b)).toContain("Action: Open System Health");
    expect(emailScript.calls).toHaveLength(0);
    const bell = await db.adminEvent.findFirst({ where: { kind: "watchdog_critical" }, orderBy: { createdAt: "desc" } });
    expect(bell?.href).toBe(`/admin/health?incident=${inc.id}`);
  });
  test("a repeat is grouped into the same incident and does not alert again", async () => {
    const s = await run(apiDown, ["app"], N(1));
    expect(s.opened).toEqual([]);
    expect(s.updated).toEqual(["app"]);
    const inc = (await openFor("app"))!;
    expect(inc.id).toBe(incId);
    expect(inc.occurrences).toBe(2);
    expect(inc.lastObservedAt.getTime()).toBe(N(1).getTime());
    expect((await deliveries(incId)).length).toBe(2);
    expect(pushScript.calls).toHaveLength(1);
    expect(await db.healthIncident.count({ where: { service: "app" } })).toBe(1);
  });
  test("still failing 30 minutes later: exactly one reminder, then quiet again", async () => {
    await run(apiDown, ["app"], N(31));
    const inc = (await openFor("app"))!;
    expect(inc.lastReminderAt?.getTime()).toBe(N(31).getTime());
    expect(sig(await deliveries(incId)).filter((x) => x.startsWith("reminder"))).toEqual(["reminder/bell/sent", "reminder/push/sent"]);
    expect(pushScript.calls.at(-1)?.payload.t).toBe("Outlly Watchdog, Still critical");
    await run(apiDown, ["app"], N(32));
    expect((await deliveries(incId)).filter((x) => x.kind === "reminder")).toHaveLength(2);
    expect((await openFor("app"))!.occurrences).toBe(4);
  });
  test("one passing check keeps the incident open (okStreak 1)", async () => {
    const s = await run(okFetch, ["app"], N(33));
    expect(s.resolved).toEqual([]);
    const inc = (await openFor("app"))!;
    expect(inc.status).toBe("open");
    expect(inc.okStreak).toBe(1);
    expect(pushScript.calls.filter((c) => c.payload.t === "Outlly Watchdog, Recovered")).toHaveLength(0);
  });
  test("the second passing check resolves it as the watchdog and sends exactly one recovery notification", async () => {
    const s = await run(okFetch, ["app"], N(34));
    expect(s.resolved).toEqual(["app"]);
    expect(await openFor("app")).toBeNull();
    const inc = (await db.healthIncident.findUnique({ where: { id: incId } }))!;
    expect(inc.status).toBe("resolved");
    expect(inc.resolvedBy).toBe("watchdog");
    expect(inc.resolvedAt?.getTime()).toBe(N(34).getTime());
    expect(inc.recoveryNotifiedAt).not.toBeNull();
    expect(sig(await deliveries(incId)).filter((x) => x.startsWith("recovery"))).toEqual(["recovery/bell/sent", "recovery/push/sent"]);
    const p = pushScript.calls.at(-1)!;
    expect(p.payload.t).toBe("Outlly Watchdog, Recovered");
    expect(String(p.payload.b)).toContain("App & API has failed has recovered");
    expect(p.payload.h).toBe(`/admin/health?incident=${incId}`);
    const notes = await db.healthIncidentNote.findMany({ where: { incidentId: incId } });
    expect(notes.some((n) => n.kind === "system" && n.text.startsWith("Recovered: 2 passing checks"))).toBe(true);
  });
  test("further passing checks neither reopen nor re-notify", async () => {
    const before = pushScript.calls.length;
    const s = await run(okFetch, ["app"], N(35));
    expect(s.opened).toEqual([]);
    expect(s.resolved).toEqual([]);
    expect(await openFor("app")).toBeNull();
    expect((await deliveries(incId)).filter((x) => x.kind === "recovery" && x.channel === "bell")).toHaveLength(1);
    expect(pushScript.calls).toHaveLength(before);
    expect(await db.healthCheck.count({ where: { service: "app" } })).toBe(7);
  });
});

describe("engine: a warning that persists escalates once", () => {
  let uid = "";
  beforeAll(async () => {
    await wipe();
    await ageOut();
    const { u } = await mkUser();
    uid = u.id;
    const m = await mkMedia(uid);
    await db.uploadSession.create({ data: { userId: uid, mediaId: m.id, objectKey: "k1", uploadId: "u1", originalFilename: "a.mp4", fileSize: 100, contentType: "video/mp4", chunkSize: 10, totalParts: 10, status: "failed", expiresAt: N(60) } });
  });
  test("one failed upload in the hour is a warning, alerted at normal urgency", async () => {
    const s = await run(okFetch, ["upload"], N0);
    expect(s.opened).toEqual(["upload"]);
    const inc = (await openFor("upload"))!;
    expect(inc.severity).toBe("warning");
    expect(inc.title).toBe("Upload is degraded");
    expect(sig(await deliveries(inc.id))).toEqual(["warning/bell/sent", "warning/push/sent"]);
    const p = pushScript.calls.at(-1)!;
    expect(p.payload.t).toBe("Outlly Watchdog, Warning");
    expect(p.urgency).toBe("normal");
    expect(p.payload.q).toBeUndefined();
  });
  test("after 30 minutes it becomes critical, with one escalation alert and no second one", async () => {
    const s = await run(okFetch, ["upload"], N(31));
    expect(s.escalated).toEqual(["upload"]);
    const inc = (await openFor("upload"))!;
    expect(inc.severity).toBe("critical");
    expect(inc.title).toBe("Upload has failed");
    expect(inc.escalatedAt?.getTime()).toBe(N(31).getTime());
    expect(pushScript.calls.at(-1)?.payload.t).toBe("Outlly Watchdog, Escalated to critical");
    const s2 = await run(okFetch, ["upload"], N(32));
    expect(s2.escalated).toEqual([]);
    const d = await deliveries(inc.id);
    expect(d.filter((x) => x.kind === "escalation" && x.channel === "bell")).toHaveLength(1);
    expect(d.filter((x) => x.kind === "reminder")).toHaveLength(0);
    expect(await db.healthIncident.count({ where: { service: "upload" } })).toBe(1);
  });
  test("three failed uploads and none completed is critical straight away", async () => {
    for (let i = 0; i < 2; i++) {
      const m = await mkMedia(uid);
      await db.uploadSession.create({ data: { userId: uid, mediaId: m.id, objectKey: `k${i}`, uploadId: `u${i}`, originalFilename: "a.mp4", fileSize: 100, contentType: "video/mp4", chunkSize: 10, totalParts: 10, status: "failed", expiresAt: N(60) } });
    }
    const r = await checks.runCheck("upload", ctx());
    expect(r.level).toBe("critical");
    expect(r.detail).toBe("3 uploads failed, 0 completed in the last hour");
    expect(r.metrics).toMatchObject({ failedLastHour: 3, completedLastHour: 0, failRatePct: 100 });
    expect(r.cause).toContain("(estimated)");
  });
});

describe("engine: cooldown, mute, off switch", () => {
  beforeAll(async () => {
    await wipe();
  });
  test("outbound network down: the platform-API probe fails outright, which on a normal-criticality service is a warning; a re-failure inside the cooldown is recorded but not re-alerted", async () => {
    const s = await run(netDown, ["platform-api"], N0);
    expect(s.opened).toEqual(["platform-api"]);
    const a = (await openFor("platform-api"))!;
    expect(a.severity).toBe("warning");
    expect(core.severityFor("critical", registry.MONITORED.find((x) => x.id === "platform-api")!)).toBe("warning");
    expect(core.severityFor("critical", registry.MONITORED.find((x) => x.id === "db")!)).toBe("critical");
    expect(a.description).toContain("No platform API host answered");
    const check = (await db.healthCheck.findFirst({ where: { service: "platform-api" }, orderBy: { checkedAt: "desc" } }))!;
    expect(JSON.parse(check.metrics).unreachable).toBe(6);
    expect(sig(await deliveries(a.id))).toEqual(["warning/bell/sent", "warning/push/sent"]);
    await db.healthIncident.update({ where: { id: a.id }, data: { status: "resolved", resolvedAt: N0, resolvedBy: "wd-super" } });
    const pushes = pushScript.calls.length;
    const s2 = await run(netDown, ["platform-api"], N(1));
    expect(s2.opened).toEqual(["platform-api"]);
    const b = (await openFor("platform-api"))!;
    expect(b.id).not.toBe(a.id);
    const d = await deliveries(b.id);
    expect(sig(d)).toEqual(["warning/bell/skipped"]);
    expect(d[0].detail.startsWith("cooldown")).toBe(true);
    expect(pushScript.calls).toHaveLength(pushes);
    expect(emailScript.calls).toHaveLength(0);
  });
  test("a muted service is still checked and recorded, but nobody is told", async () => {
    await setConfig({ muted: ["auth"] });
    const pushes = pushScript.calls.length;
    const s = await run(authDown, ["auth"], N0);
    expect(s.opened).toEqual(["auth"]);
    const inc = (await openFor("auth"))!;
    expect(inc.severity).toBe("critical");
    expect(await deliveries(inc.id)).toHaveLength(0);
    expect(pushScript.calls).toHaveLength(pushes);
    expect(await db.adminEvent.count({ where: { kind: "watchdog_critical", href: `/admin/health?incident=${inc.id}` } })).toBe(0);
    await setConfig({});
  });
  test("turning the watchdog off skips the sweep cycle but never a manual run", async () => {
    await setConfig({ enabled: false });
    const s = await engine.runHealthCycle({ origin: ORIGIN, fetch: okFetch, now: N0, source: "test" });
    expect(s.skipped).toBe("disabled");
    expect(s.ran).toEqual([]);
    const m = await run(okFetch, ["db"], N0);
    expect(m.ran).toEqual(["db"]);
    await setConfig({});
  });
  test("intervals are respected by the sweep and overridable in the config", async () => {
    await db.healthCheck.deleteMany({ where: { service: "push" } });
    const s1 = await engine.runHealthCycle({ origin: ORIGIN, fetch: okFetch, now: N0, source: "test", only: ["push"] });
    expect(s1.ran).toEqual(["push"]);
    const due = await engine.runHealthCycle({ origin: ORIGIN, fetch: okFetch, now: N(1), source: "test", quiet: true });
    expect(due.ran).not.toContain("push");
    await setConfig({ intervals: { push: 60 } });
    const due2 = await engine.runHealthCycle({ origin: ORIGIN, fetch: okFetch, now: N(2), source: "test", quiet: true });
    expect(due2.ran).toContain("push");
    await setConfig({});
  });
});

describe("alert delivery: push refused, email backup, nothing claimed that did not happen", () => {
  let uid = "";
  let mediaId = "";
  beforeAll(async () => {
    await wipe();
    await ageOut();
    await clearDevices();
    const sup = await mkAdmin("super");
    await mkDevice(sup.id);
    const { u, media } = await mkUser();
    uid = u.id;
    mediaId = media.id;
  });
  test("publishing delayed: five overdue scheduled posts; the push is refused so the critical goes to the alert email", async () => {
    pushScript.outcome = "rejected";
    await setConfig({ alertEmail: "ops@example.com" });
    for (let i = 0; i < 5; i++) await db.post.create({ data: { userId: uid, mediaId, status: "scheduled", requireApproval: false, scheduledAt: N(-10) } });
    const s = await run(okFetch, ["queue"], N0);
    expect(s.opened).toEqual(["queue"]);
    const inc = (await openFor("queue"))!;
    expect(inc.severity).toBe("critical");
    expect(inc.title).toBe("Job queue has failed");
    expect(inc.description).toContain("5 scheduled posts overdue");
    expect(inc.affectedCount).toBe(5);
    const d = await deliveries(inc.id);
    expect(sig(d)).toEqual(["critical/bell/sent", "critical/email/sent", "critical/push/failed"]);
    expect(d.find((x) => x.channel === "email")?.detail).toContain("accepted by the provider");
    expect(emailScript.calls).toHaveLength(1);
    expect(emailScript.calls[0].to).toBe("ops@example.com");
    expect(emailScript.calls[0].kind).toBe("watchdog");
    expect(emailScript.calls[0].subject).toBe("Outlly Watchdog, Critical: Job queue has failed");
    expect(emailScript.calls[0].text).toContain("Action: Open System Health");
  });
  test("publishing failing: five failed Instagram targets; the mock email provider is recorded as failed, the error is redacted", async () => {
    emailScript.status = "mocked";
    for (let i = 0; i < 5; i++) {
      const post = await db.post.create({ data: { userId: uid, mediaId, status: "failed" } });
      await db.postTarget.create({ data: { postId: post.id, platform: "instagram", platformStatus: "failed", practice: false, errorCode: "OAuthException", errorMessage: `Token expired for user@example.com at 10.1.2.3` } });
    }
    const s = await run(okFetch, ["publish:instagram"], N0);
    expect(s.opened).toEqual(["publish:instagram"]);
    const inc = (await openFor("publish:instagram"))!;
    expect(inc.severity).toBe("critical");
    expect(inc.title).toBe("Instagram publishing has failed");
    expect(inc.description).toContain("5 Instagram posts failed and none succeeded");
    expect(inc.errorDetail).not.toContain("user@example.com");
    expect(inc.errorDetail).not.toContain("10.1.2.3");
    expect(inc.errorDetail).toContain("<email>");
    const d = await deliveries(inc.id);
    expect(sig(d)).toEqual(["critical/bell/sent", "critical/email/failed", "critical/push/failed"]);
    expect(d.find((x) => x.channel === "email")?.detail).toContain("mock");
    expect(emailScript.calls).toHaveLength(2);
    emailScript.status = "sent";
  });
  test("worker stops: with no alert device and no email, both channels are recorded as skipped, never as sent", async () => {
    await clearDevices();
    await setConfig({});
    pushScript.outcome = "sent";
    await db.post.deleteMany({ where: { userId: uid } });
    await recordSweep("inproc", N0.getTime() - 10 * 60_000);
    const pushes = pushScript.calls.length;
    const s = await run(okFetch, ["sweeper"], N0);
    expect(s.opened).toEqual(["sweeper"]);
    const inc = (await openFor("sweeper"))!;
    expect(inc.severity).toBe("critical");
    expect(inc.description).toContain("Last inproc sweep 10 min ago");
    expect(sig(await deliveries(inc.id))).toEqual(["critical/bell/sent", "critical/email/skipped", "critical/push/skipped"]);
    expect(pushScript.calls).toHaveLength(pushes);
    expect(emailScript.calls).toHaveLength(2);
  });
  test("worker back: two fresh sweeps resolve it with a single recovery notification", async () => {
    const inc = (await openFor("sweeper"))!;
    await recordSweep("inproc", N(1).getTime());
    await run(okFetch, ["sweeper"], N(1));
    expect((await openFor("sweeper"))!.okStreak).toBe(1);
    const s = await run(okFetch, ["sweeper"], N(2));
    expect(s.resolved).toEqual(["sweeper"]);
    const done = (await db.healthIncident.findUnique({ where: { id: inc.id } }))!;
    expect(done.status).toBe("resolved");
    expect(done.resolvedBy).toBe("watchdog");
    expect(sig(await deliveries(inc.id)).filter((x) => x.startsWith("recovery"))).toEqual(["recovery/bell/sent", "recovery/push/skipped"]);
    await run(okFetch, ["sweeper"], N(3));
    expect((await deliveries(inc.id)).filter((x) => x.kind === "recovery" && x.channel === "bell")).toHaveLength(1);
  });
});

describe("probes never throw and never guess", () => {
  test("the dashboard API answering 503 is the database as the app sees it: critical", async () => {
    const r = await checks.runCheck("app", ctx({ fetch: dbDownApi }));
    expect(r.level).toBe("critical");
    expect(r.detail).toBe("/api/health reports it cannot reach the database");
    expect(r.cause).toContain("(estimated)");
    expect(r.threw).toBeUndefined();
  });
  test("any other probe past its deadline is unknown and flagged as thrown, never reported healthy", async () => {
    const slow: typeof fetch = () => new Promise((res) => setTimeout(() => res(new Response("ok")), 2_000));
    const r = await checks.runCheck("app", ctx({ fetch: slow, deadlineMs: 600 }));
    expect(r.level).toBe("unknown");
    expect(r.threw).toBe(true);
    expect(r.detail).toContain("timed out");
  });
  test("an unknown probe name is unknown", async () => {
    const r = await checks.runCheck("nope" as never, ctx());
    expect(r.level).toBe("unknown");
    expect(r.threw).toBe(true);
  });
});

describe("independent heartbeat monitor", () => {
  beforeAll(async () => {
    await wipe();
    await db.setting.deleteMany({ where: { key: { in: [engine.LAST_CYCLE_KEY, engine.HEARTBEAT_KEY] } } });
  });
  test("monitoring worker stops (no cycle recorded): the watchdog incident opens and is alerted", async () => {
    const hb = await engine.heartbeatCheck(ORIGIN, N0);
    expect(hb.stale).toBe(true);
    expect(hb.ageMs).toBeNull();
    expect(hb.opened).toEqual(["watchdog"]);
    const inc = (await openFor("watchdog"))!;
    expect(inc.severity).toBe("critical");
    expect(inc.title).toBe("Watchdog itself has failed");
    expect(inc.description).toContain("never completed a cycle");
    expect(sig(await deliveries(inc.id)).some((x) => x === "critical/bell/sent")).toBe(true);
    const hbRow = await db.setting.findUnique({ where: { key: engine.HEARTBEAT_KEY } });
    expect(hbRow?.value).toBe(String(N0.getTime()));
  });
  test("the cron route needs the CRON_SECRET bearer", async () => {
    expect((await GET(cronHealth.GET as Handler, "/api/cron/health")).status).toBe(401);
    expect((await GET(cronHealth.GET as Handler, "/api/cron/health", { authorization: "Bearer wrong" })).status).toBe(401);
  });
  test("a full cycle runs every monitored probe inside the budget, none throws, and records itself", async () => {
    const s = await engine.runHealthCycle({ origin: ORIGIN, fetch: okFetch, now: new Date(), force: true, source: "test", quiet: true, budgetMs: 30_000 });
    expect(s.skipped).toBeUndefined();
    expect(s.deferred).toEqual([]);
    expect([...s.ran].sort()).toEqual(registry.MONITORED.map((x) => x.id).sort());
    expect(s.threw).toBe(0);
    const c = await engine.lastCycle();
    expect(c?.source).toBe("test");
    expect(c?.ran).toBe(registry.MONITORED.length);
  });
  test("with the cycle fresh the route answers 200; two fresh passes close the watchdog incident with one recovery alert", async () => {
    const inc = (await openFor("watchdog"))!;
    const r1 = await GET(cronHealth.GET as Handler, "/api/cron/health", { authorization: "Bearer r1195-cron-secret" });
    expect(r1.status).toBe(200);
    const j1 = await r1.json();
    expect(j1.heartbeat.stale).toBe(false);
    expect(j1.cycle).toBeNull();
    expect((await openFor("watchdog"))!.okStreak).toBe(1);
    const r2 = await GET(cronHealth.GET as Handler, "/api/cron/health", { authorization: "Bearer r1195-cron-secret" });
    expect((await r2.json()).heartbeat.resolved).toEqual(["watchdog"]);
    const done = (await db.healthIncident.findUnique({ where: { id: inc.id } }))!;
    expect(done.status).toBe("resolved");
    expect(done.resolvedBy).toBe("watchdog");
    await GET(cronHealth.GET as Handler, "/api/cron/health", { authorization: "Bearer r1195-cron-secret" });
    expect((await deliveries(inc.id)).filter((x) => x.kind === "recovery" && x.channel === "bell")).toHaveLength(1);
    expect(await openFor("watchdog")).toBeNull();
  });
});

describe("admin API: System Health, incidents, alert devices", () => {
  let sup: Awaited<ReturnType<typeof mkAdmin>>;
  let supp: Awaited<ReturnType<typeof mkAdmin>>;
  let incId = "";
  let deviceId = "";
  const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
  beforeAll(async () => {
    await wipe();
    await clearDevices();
    sup = await mkAdmin("super", "Sam Super");
    supp = await mkAdmin("support", "Sue Support");
    await run(apiDown, ["app"], new Date(), { quiet: true });
    incId = (await openFor("app"))!.id;
  });
  test("a support admin reads the overview: every service listed, unmonitored ones say why, settings hidden", async () => {
    await asAdmin(supp);
    const r = await GET(healthRoute.GET as Handler, "/api/admin/health?range=24h");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.role).toBe("support");
    expect(j.config).toBeNull();
    expect(j.services).toHaveLength(registry.SERVICES.length);
    const app = j.services.find((s: { id: string }) => s.id === "app");
    expect(app.level).toBe("critical");
    expect(app.monitored).toBe(true);
    const sync = j.services.find((s: { id: string }) => s.id === "subtitle-sync");
    expect(sync.monitored).toBe(false);
    expect(sync.why.length).toBeGreaterThan(10);
    const never = j.services.find((s: { id: string }) => s.id === "db");
    expect(never.level).toBe("unknown");
    expect(never.lastCheckedAt).toBeNull();
    expect(j.summary.overall).toBe("critical");
    expect(j.summary.openCritical).toBe(1);
    expect(j.incidents).toHaveLength(1);
    expect(j.incidents[0].id).toBe(incId);
    expect(j.worker.sweep.source).toBe("inproc");
    expect(typeof j.worker.model).toBe("string");
    expect(typeof j.worker.heartbeat.configured).toBe("boolean");
    expect(j.intervalsDefault.db).toBe(60);
    expect(typeof j.vapidPublicKey).toBe("string");
  });
  test("run-now and settings are super only", async () => {
    await asAdmin(supp);
    expect((await POST(healthRoute.POST as Handler, "/api/admin/health", { action: "run", only: ["db"] })).status).toBe(403);
    expect((await POST(healthRoute.POST as Handler, "/api/admin/health", { action: "config", config: { enabled: true, intervals: {}, alertEmail: "", muted: [] } })).status).toBe(403);
    signOut();
    expect((await GET(healthRoute.GET as Handler, "/api/admin/health")).status).toBe(401);
  });
  test("a super admin runs a check by hand and saves settings; the overview shows the masked alert email", async () => {
    await asAdmin(sup);
    const r = await POST(healthRoute.POST as Handler, "/api/admin/health", { action: "run", only: ["db"] });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.cycle.ran).toEqual(["db"]);
    expect(j.cycle.threw).toBe(0);
    const c = await POST(healthRoute.POST as Handler, "/api/admin/health", { action: "config", config: { enabled: true, intervals: { db: 120, push: 30 }, alertEmail: "ops@example.com", muted: ["pip"] } });
    expect(c.status).toBe(400);
    const c2 = await POST(healthRoute.POST as Handler, "/api/admin/health", { action: "config", config: { enabled: true, intervals: { db: 120 }, alertEmail: "ops@example.com", muted: ["pip"] } });
    expect(c2.status).toBe(200);
    const g = await (await GET(healthRoute.GET as Handler, "/api/admin/health")).json();
    expect(g.config.intervals.db).toBe(120);
    expect(g.config.muted).toEqual(["pip"]);
    expect(g.worker.alertEmail).toBeTruthy();
    expect(g.worker.alertEmail).not.toBe("ops@example.com");
    expect(g.services.find((s: { id: string }) => s.id === "db").level).toBe("ok");
    await setConfig({});
  });
  test("incident list filters and exports CSV", async () => {
    await asAdmin(sup);
    const l = await (await GET(incidentsRoute.GET as Handler, "/api/admin/health/incidents?status=active")).json();
    expect(l.total).toBe(1);
    expect(l.incidents[0].service).toBe("app");
    const none = await (await GET(incidentsRoute.GET as Handler, "/api/admin/health/incidents?status=resolved&range=1h")).json();
    expect(none.total).toBe(0);
    const q = await (await GET(incidentsRoute.GET as Handler, "/api/admin/health/incidents?q=nothing-matches-this")).json();
    expect(q.total).toBe(0);
    const csv = await GET(incidentsRoute.GET as Handler, "/api/admin/health/incidents?service=app&format=csv");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type") ?? "").toContain("text/csv");
    const text = await csv.text();
    expect(text).toContain(incId);
    expect(text.split("\n")[0]).toContain("service");
  });
  test("acknowledge never resolves; investigate, assign, note, resolve (with who) and reopen are separate steps in the trail", async () => {
    await asAdmin(sup);
    const path = `/api/admin/health/incidents/${incId}`;
    const ack = await (await PATCH(incidentRoute.PATCH as Handler, path, { action: "ack" })).json();
    expect(ack.incident.status).toBe("acknowledged");
    expect(ack.incident.ackAt).toBeTruthy();
    expect(ack.incident.resolvedAt).toBeNull();
    expect(ack.notes.some((n: { kind: string }) => n.kind === "ack")).toBe(true);
    expect((await openFor("app"))!.id).toBe(incId);
    const inv = await (await PATCH(incidentRoute.PATCH as Handler, path, { action: "investigate" })).json();
    expect(inv.incident.status).toBe("investigating");
    const asg = await (await PATCH(incidentRoute.PATCH as Handler, path, { action: "assign", assigneeId: sup.id })).json();
    expect(asg.incident.assigneeId).toBe(sup.id);
    expect(asg.incident.assigneeName).toBe("Sam Super");
    expect((await PATCH(incidentRoute.PATCH as Handler, path, { action: "assign", assigneeId: "nobody" })).status).toBe(404);
    const un = await (await PATCH(incidentRoute.PATCH as Handler, path, { action: "assign", assigneeId: null })).json();
    expect(un.incident.assigneeId).toBeNull();
    expect((await PATCH(incidentRoute.PATCH as Handler, path, { action: "note", text: "   " })).status).toBe(400);
    const nt = await (await PATCH(incidentRoute.PATCH as Handler, path, { action: "note", text: "Restarted the API deployment" })).json();
    expect(nt.notes.some((n: { kind: string; text: string; adminName?: string | null }) => n.kind === "note" && n.text === "Restarted the API deployment")).toBe(true);
    const res = await (await PATCH(incidentRoute.PATCH as Handler, path, { action: "resolve", text: "Confirmed healthy" })).json();
    expect(res.incident.status).toBe("resolved");
    expect(res.incident.resolvedBy).toBe(sup.login);
    expect(res.incident.recoveryNotifiedAt).toBeTruthy();
    expect(await openFor("app")).toBeNull();
    expect((await PATCH(incidentRoute.PATCH as Handler, path, { action: "ack" })).status).toBe(409);
    expect((await PATCH(incidentRoute.PATCH as Handler, path, { action: "reopen" })).status).toBe(200);
    expect((await PATCH(incidentRoute.PATCH as Handler, path, { action: "reopen" })).status).toBe(409);
    const d = await (await GET(incidentRoute.GET as Handler, path)).json();
    expect(d.incident.status).toBe("open");
    expect(d.incident.resolvedAt).toBeNull();
    expect(d.notes.length).toBeGreaterThanOrEqual(7);
    expect(d.checks.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(d.deliveries)).toBe(true);
    expect((await GET(incidentRoute.GET as Handler, "/api/admin/health/incidents/does-not-exist")).status).toBe(404);
  });
  test("a manually resolved incident gets no recovery notification from the engine, and a healthy service after that stays quiet", async () => {
    await asAdmin(sup);
    await PATCH(incidentRoute.PATCH as Handler, `/api/admin/health/incidents/${incId}`, { action: "resolve" });
    const before = (await deliveries(incId)).length;
    await run(okFetch, ["app"], new Date());
    await run(okFetch, ["app"], new Date(Date.now() + 60_000));
    expect((await deliveries(incId)).length).toBe(before);
    expect(await openFor("app")).toBeNull();
  });
  test("turning alert pushes on for this browser enrols an alert device, the test alert reaches it, and it can be removed", async () => {
    await asAdmin(sup);
    const key = (await vapidKeys()).publicKey;
    const p256 = new Uint8Array(65);
    p256[0] = 4;
    for (let i = 1; i < 65; i++) p256[i] = (i * 7) & 255;
    const sub = { endpoint: `https://fcm.googleapis.com/fcm/send/${tag()}`, keys: { p256dh: b64u(p256), auth: b64u(new Uint8Array(16).fill(9)) } };
    expect((await POST(devicesRoute.POST as Handler, "/api/admin/health/devices", { sub, installed: false, touchMac: false, key: "not-the-current-key" })).status).toBe(409);
    expect((await POST(devicesRoute.POST as Handler, "/api/admin/health/devices", { sub: { ...sub, endpoint: "https://evil.example.com/push" }, key })).status).toBe(400);
    const r = await POST(devicesRoute.POST as Handler, "/api/admin/health/devices", { sub, installed: true, touchMac: false, key });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.devices).toHaveLength(1);
    deviceId = j.id;
    const again = await (await POST(devicesRoute.POST as Handler, "/api/admin/health/devices", { sub, key })).json();
    expect(again.devices).toHaveLength(1);
    expect(again.id).toBe(deviceId);
    const list = await (await GET(devicesRoute.GET as Handler, "/api/admin/health/devices")).json();
    expect(list.devices[0].id).toBe(deviceId);
    const pushes = pushScript.calls.length;
    const t = await (await POST(healthRoute.POST as Handler, "/api/admin/health", { action: "test-alert" })).json();
    expect(t.status).toBe("sent");
    expect(t.devices).toBe(1);
    expect(t.sent).toBe(1);
    expect(pushScript.calls).toHaveLength(pushes + 1);
    expect(pushScript.calls.at(-1)?.payload.t).toBe("Outlly Watchdog, Test");
    expect(pushScript.calls.at(-1)?.payload.h).toBe("/admin/health");
    expect(await db.healthAlertDelivery.count({ where: { kind: "test", adminId: sup.id, status: "sent" } })).toBe(1);
    await asAdmin(supp);
    expect((await (await GET(devicesRoute.GET as Handler, "/api/admin/health/devices")).json()).devices).toHaveLength(0);
    await asAdmin(sup);
    const del = await (await DEL(devicesRoute.DELETE as Handler, "/api/admin/health/devices", { id: deviceId })).json();
    expect(del.removed).toBe(1);
    expect(del.devices).toHaveLength(0);
    const t2 = await (await POST(healthRoute.POST as Handler, "/api/admin/health", { action: "test-alert" })).json();
    expect(t2.status).toBe("skipped");
    expect(t2.ok).toBe(false);
  });
  test("the service worker opens admin alerts in an admin window", async () => {
    const sw = await Bun.file(new URL("../public/sw.js", import.meta.url)).text();
    expect(sw).toContain('path.startsWith("/admin")');
  });
});
