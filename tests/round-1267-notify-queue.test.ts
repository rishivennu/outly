/** R1267: admin Notifications queue and dead letters: URL filters, the where-clauses they build, and the retry route. */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

const g = globalThis as unknown as { __r1267Admin?: unknown };
// Run-wide mock (bun keeps it for every file): falls through to the real session unless this file's flag is set.
const realAdminAuth = await import("../lib/admin/auth");
const realGetAdmin = realAdminAuth.getAdmin;
mock.module("../lib/admin/auth", () => ({ ...realAdminAuth, getAdmin: async () => (g.__r1267Admin !== undefined ? g.__r1267Admin : realGetAdmin()) }));

const { db } = await import("../lib/db");
const N = await import("../lib/admin/notifications");
const engine = await import("../lib/notify-engine");
const { POST } = await import("../app/api/admin/notifications/retry/route");
const { manySaid } = await import("../components/admin/notifications/RetryButton");

const src = (f: string) => readFileSync(join(import.meta.dir, "..", f), "utf8").replace(/\r\n/g, "\n");
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const mkUser = () => db.user.create({ data: { name: "Queue Probe", email: `q-${uniq()}@test.dev`, passwordHash: "x" } });
const admin = (role: string) => ({ id: "adm-r1267", name: "R1267 admin", login: "r1267", role });
const f = (o: Partial<import("../lib/admin/notifications").QueueFilters> = {}) => ({ ...N.parseQueueFilters({}), ...o });
const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/admin/notifications/retry", { method: "POST", headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({}) } as never);

// A kind whose handler this file controls: fail until `heal` is set, then deliver.
const KIND = `r1267_${uniq()}`;
let heal = false;
engine.registerHandler(KIND, async () => (heal ? { ok: true } : { ok: false, reason: "provider said no (R1267 probe)" }));

async function deadOne(userId: string, title = "Probe title") {
  const key = `r1267:${uniq()}`;
  const r = await engine.recordEvent({ userId, kind: KIND as never, source: "test:r1267", idemKey: key, payload: { title, body: "B", key, email: true } });
  const ev = await db.notifyEvent.findUniqueOrThrow({ where: { id: r.id! }, select: { id: true, userId: true, kind: true, source: true, idemKey: true, accountId: true, priority: true, payload: true, attempts: true } });
  expect((await engine.processEvent(ev)).status).toBe("dead");
  return db.notifyDeadLetter.findFirstOrThrow({ where: { idemKey: key } });
}

afterAll(() => {
  g.__r1267Admin = undefined;
});

describe("R1267 URL filters", () => {
  test("defaults, junk and swapped dates", () => {
    expect(N.parseQueueFilters({})).toEqual({ q: "", status: "", channel: "", from: "", to: "", limit: 25 });
    expect(N.parseQueueFilters({ q: "  greet ", status: "bogus", channel: "fax", limit: "7", from: "2026-13-40", to: "yesterday" })).toEqual({ q: "greet", status: "", channel: "", from: "", to: "", limit: 25 });
    expect(N.parseQueueFilters({ status: ["retrying", "dead"], channel: "email", limit: "100", from: "2026-11-20", to: "2026-11-01" })).toMatchObject({ status: "retrying", channel: "email", limit: 100, from: "2026-11-01", to: "2026-11-20" });
    expect(N.parseQueueFilters({ q: "x".repeat(300) }).q).toHaveLength(100);
    expect(N.filtersOn(f())).toBe(false);
    expect(N.filtersOn(f({ limit: 100 }))).toBe(false);
    expect(N.filtersOn(f({ channel: "inapp" }))).toBe(true);
  });

  test("status picks the queue rows, and rules a list out instead of faking an empty one", () => {
    expect(N.queueWhere(f())).toEqual({ status: "pending" });
    expect(N.queueWhere(f({ status: "waiting" }))).toEqual({ status: "pending", attempts: 0 });
    expect(N.queueWhere(f({ status: "retrying" }))).toEqual({ status: "pending", attempts: { gt: 0 } });
    expect(N.queueWhere(f({ status: "failed" }))).toEqual({ status: "failed" });
    expect(N.queueWhere(f({ status: "dead" }))).toBeNull();
    expect(N.deadLetterWhere(f())).toEqual({});
    expect(N.deadLetterWhere(f({ status: "dead" }))).toEqual({});
    for (const s of ["waiting", "retrying", "failed"] as const) expect(N.deadLetterWhere(f({ status: s }))).toBeNull();
  });

  test("search covers kind, recipient id and title, with no `mode` so SQLite keeps working", () => {
    const w = N.queueWhere(f({ q: "Ab" }))!;
    const or = (w.AND as { OR: Record<string, { contains: string }>[] }[])[0].OR;
    expect(or).toEqual(expect.arrayContaining([{ kind: { contains: "Ab" } }, { userId: { contains: "Ab" } }, { payload: { contains: "Ab" } }, { payload: { contains: "ab" } }]));
    expect(JSON.stringify(w)).not.toContain("mode");
    expect((N.queueWhere(f({ q: "ab" }))!.AND as { OR: unknown[] }[])[0].OR).toHaveLength(3);
    expect(JSON.stringify(N.deadLetterWhere(f({ q: "Ab" })))).toBe(JSON.stringify({ AND: [{ OR: or }] }));
  });

  test("channel is the one an event asks for itself", () => {
    expect(N.queueWhere(f({ channel: "email" }))).toEqual({ status: "pending", AND: [{ payload: { contains: '"email":true' } }] });
    expect(N.deadLetterWhere(f({ channel: "inapp" }))).toEqual({ AND: [{ NOT: { payload: { contains: '"email":true' } } }] });
  });

  test("dates are inclusive UTC days", () => {
    expect(N.queueWhere(f({ from: "2026-11-01", to: "2026-11-20" }))).toEqual({ status: "pending", createdAt: { gte: new Date("2026-11-01T00:00:00Z"), lt: new Date("2026-11-21T00:00:00Z") } });
    expect(N.deadLetterWhere(f({ to: "2026-11-20" }))).toEqual({ createdAt: { lt: new Date("2026-11-21T00:00:00Z") } });
    expect(N.deadLetterWhere(f({ from: "2026-11-01" }))).toEqual({ createdAt: { gte: new Date("2026-11-01T00:00:00Z") } });
  });
});

describe("R1267 search against the database", () => {
  test("queue and dead letters come back with tries, error, title and the creator's address", async () => {
    heal = false;
    const u = await mkUser();
    const t = `Needle ${uniq()}`;
    const key = `r1267:${uniq()}`;
    await engine.recordEvent({ userId: u.id, kind: "new_comment", source: "test:r1267", idemKey: key, payload: { title: t, body: "B", key } });
    const q = (await N.searchQueue(f({ q: t.toLowerCase(), status: "waiting", channel: "inapp" })))!;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ title: t, attempts: 0, email: false, userEmail: u.email, userId: u.id });
    expect(await N.searchQueue(f({ q: t, channel: "email" }))).toHaveLength(0);
    expect(await N.searchQueue(f({ status: "dead" }))).toBeNull();

    const dl = await deadOne(u.id, t);
    const d = (await N.searchDeadLetters(f({ q: u.id, channel: "email" })))!;
    expect(d.map((r) => r.id)).toContain(dl.id);
    expect(d.find((r) => r.id === dl.id)).toMatchObject({ title: t, attempts: 1, email: true, userEmail: u.email, error: "provider said no (R1267 probe)" });
    expect(await N.searchDeadLetters(f({ q: u.id, status: "retrying" }))).toBeNull();
    expect(await N.searchDeadLetters(f({ q: u.id, to: "2001-01-01" }))).toHaveLength(0);
    expect((await N.searchDeadLetters(f({ limit: 25 })))!.length).toBeLessThanOrEqual(25);
  });
});

describe("R1267 retry route", () => {
  beforeAll(() => {
    g.__r1267Admin = admin("super");
  });

  test("happy path: re-queued, run at once, gone from the dead letters, audited", async () => {
    heal = false;
    const u = await mkUser();
    const dl = await deadOne(u.id);
    heal = true;
    const res = await post({ id: dl.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "done" });
    expect(await db.notifyDeadLetter.count({ where: { idemKey: dl.idemKey } })).toBe(0);
    expect(await db.notifyEvent.findUnique({ where: { idemKey: dl.idemKey }, select: { status: true, attempts: true, lastError: true } })).toEqual({ status: "done", attempts: 1, lastError: null });
    const audit = await N.notifyAudit(3);
    expect(audit[0]).toMatchObject({ kind: "notify_retry", title: "Dead letter retried" });
  });

  test("requeue gives the event a clean slate: four fresh tries, due now", async () => {
    heal = false;
    const u = await mkUser();
    const dl = await deadOne(u.id);
    const r = await engine.requeue(dl.id);
    expect(r.ok).toBe(true);
    const ev = await db.notifyEvent.findUnique({ where: { idemKey: dl.idemKey }, select: { status: true, attempts: true, lastError: true, processedAt: true } });
    expect(ev).toEqual({ status: "pending", attempts: 0, lastError: null, processedAt: null });
    expect(await engine.requeue(dl.id)).toEqual({ ok: false, reason: "not_found" });
  });

  test("unknown id is a 404, bad input a 400", async () => {
    const res = await post({ id: "no-such-dead-letter" });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
    expect((await post({})).status).toBe(400);
  });

  test("a dead letter whose event is gone (creator deleted) is a 409, and is kept", async () => {
    const dl = await db.notifyDeadLetter.create({ data: { userId: "deleted-user", kind: KIND, source: "test:r1267", idemKey: `r1267:gone:${uniq()}`, error: "x", attempts: 4 } });
    const res = await post({ id: dl.id });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("GONE");
    expect(await db.notifyDeadLetter.count({ where: { id: dl.id } })).toBe(1);
  });

  test("retry all: sequential counts, and capped at 100 per call", async () => {
    heal = false;
    const u = await mkUser();
    const a = await deadOne(u.id);
    const b = await deadOne(u.id);
    heal = true;
    const res = await post({ ids: [a.id, b.id, a.id, "missing-one"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 3, done: 2, retry: 0, dead: 0, skipped: 1 });
    const many = Array.from({ length: 101 }, (_, i) => `x${i}`);
    const capped = await post({ ids: many });
    expect(capped.status).toBe(400);
    expect(await db.adminEvent.count({ where: { kind: "notify_retry", body: { contains: "101" } } })).toBe(0);
  });

  test("signed out is a 401, a role without the Notifications screen a 403", async () => {
    g.__r1267Admin = null;
    expect((await post({ id: "x" })).status).toBe(401);
    g.__r1267Admin = admin("support");
    expect((await post({ id: "x" })).status).toBe(403);
    g.__r1267Admin = admin("super");
  });

  test("the toast for a batch says what happened", () => {
    expect(manySaid({ total: 2, done: 2, retry: 0, dead: 0, skipped: 0 })).toEqual(["Retried 2: 2 sent.", "ok"]);
    expect(manySaid({ total: 3, done: 1, retry: 1, dead: 0, skipped: 1 })).toEqual(["Retried 3: 1 sent, 1 back in the queue, 1 already gone.", "info"]);
    expect(manySaid({ total: 1, done: 0, retry: 0, dead: 1, skipped: 0 })[1]).toBe("error");
  });
});

describe("R1267 house rules", () => {
  test("the page filters through the shared FilterBar and the URL", () => {
    const page = src("app/admin/(panel)/notifications/page.tsx");
    const bar = src("components/admin/notifications/QueueFilters.tsx");
    expect(bar).toContain('from "@/components/admin/FilterBar"');
    expect(bar).toContain("<AdminFilterBar");
    for (const p of ["q", "status", "channel", "from", "to", "limit"]) expect(bar).toMatch(new RegExp(`param="${p}"|SearchBox`));
    expect(page).toContain("parseQueueFilters(await props.searchParams)");
    expect(page).toContain("Nothing matches these filters.");
    expect(page).toContain("adminEmail(");
    expect(bar.startsWith('"use client"')).toBe(false);
  });

  test("retry buttons are 44px, show they are busy, and refresh the page", () => {
    const b = src("components/admin/notifications/RetryButton.tsx");
    expect(b.startsWith('"use client"')).toBe(true);
    expect(b).toContain("min-h-11");
    expect(b).toContain("aria-busy={busy}");
    expect(b).toContain("router.refresh()");
    expect(b).toContain("useToast");
    const r = src("app/api/admin/notifications/retry/route.ts");
    expect(r).toContain('adminRoute(\n  "site"');
    expect(r).toMatch(/max\(RETRY_MAX/);
  });
});
