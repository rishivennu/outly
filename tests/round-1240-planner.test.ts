/**
 * R1240: Growth Planner lifecycle (lib/intelligence/planner-core.ts + planner.ts) against the test database: every
 * legal move and an illegal one per state, the 5 s double-click window, save making exactly one Idea, the event trail,
 * tenant isolation, roles, the accept prefill and the API routes.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));
const g = globalThis as unknown as { __r1240User?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__r1240User !== undefined ? g.__r1240User : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let core: typeof import("../lib/intelligence/planner-core");
let planner: typeof import("../lib/intelligence/planner");
let one: typeof import("../app/api/recommendations/[id]/route");
let events: typeof import("../app/api/recommendations/[id]/events/route");
let list: typeof import("../app/api/recommendations/route");
let n = 0;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  core = await import("../lib/intelligence/planner-core");
  planner = await import("../lib/intelligence/planner");
  one = await import("../app/api/recommendations/[id]/route");
  events = await import("../app/api/recommendations/[id]/events/route");
  list = await import("../app/api/recommendations/route");
}, 60_000);
afterAll(() => {
  delete g.__r1240User;
});

async function user() {
  return db.user.create({ data: { name: `P ${++n}`, email: `r1240-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
}
async function rec(ownerId: string, status = "open") {
  const today = new Date().toISOString().slice(0, 10);
  return db.recommendation.create({
    data: {
      ownerId,
      scopeKey: "",
      dedupeKey: `k${++n}`,
      title: "Make more carousels",
      concept: "Carousels get twice the saves.",
      why: "Your carousels beat your videos on saves.",
      evidence: JSON.stringify({ postIds: ["evA", "evB"] }),
      postsAnalyzed: 12,
      periodFrom: today,
      periodTo: today,
      confidence: "medium",
      format: "carousel",
      platform: "instagram",
      nextAction: JSON.stringify({ kind: "create", label: "Draft it", prefill: { platform: "instagram", format: "carousel", topic: "Recipes", basedOn: ["p1", "p2"] } }),
      status,
    },
  });
}
const owner = (id: string) => ({ id, role: "owner" });
const err = async (p: Promise<unknown>) => p.then(() => null, (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }));
/** Moves the last event out of the double-click window, so the next call is a real one. */
const age = (recommendationId: string) => db.recommendationEvent.updateMany({ where: { recommendationId }, data: { at: new Date(Date.now() - 60_000) } });

describe("R1240 planner-core", () => {
  test("transitions match the documented machine", () => {
    expect(core.transitions("open")).toEqual(["accept", "edit", "reject", "save", "feedback"]);
    expect(core.transitions("saved")).toEqual(["accept", "edit", "reject", "feedback"]);
    expect(core.transitions("edited")).toEqual(["edit", "done", "reject", "feedback"]);
    expect(core.transitions("accepted")).toEqual(["done", "reject", "feedback"]);
    for (const s of ["rejected", "done", "expired", "nonsense"]) expect(core.transitions(s)).toEqual(["feedback"]);
  });

  const base = { status: "open", title: "T", concept: "C", format: "video", platform: "instagram" };
  test("every legal move per state lands on the right status, and one illegal move per state is refused", () => {
    const legal: [string, string, string][] = [
      ["open", "accept", "accepted"], ["open", "edit", "edited"], ["open", "reject", "rejected"], ["open", "save", "saved"],
      ["saved", "accept", "accepted"], ["saved", "edit", "edited"], ["saved", "reject", "rejected"],
      ["edited", "edit", "edited"], ["edited", "done", "done"], ["edited", "reject", "rejected"],
      ["accepted", "done", "done"], ["accepted", "reject", "rejected"],
    ];
    for (const [from, action, to] of legal) {
      const r = core.applyAction({ ...base, status: from }, action, action === "edit" ? { title: `New ${from}` } : undefined, "a");
      expect(core.isPlannerError(r)).toBe(false);
      if (!core.isPlannerError(r)) expect(r.next.status).toBe(to as never);
    }
    const illegal: [string, string][] = [["open", "done"], ["saved", "save"], ["edited", "accept"], ["accepted", "edit"], ["rejected", "accept"], ["done", "reject"], ["expired", "accept"]];
    for (const [from, action] of illegal) {
      const r = core.applyAction({ ...base, status: from }, action, { title: "x" }, "a");
      expect(core.isPlannerError(r) && r.error).toBe("ILLEGAL_TRANSITION");
    }
    expect(core.isPlannerError(core.applyAction(base, "reopen", null, "a")) && "UNKNOWN_ACTION").toBe("UNKNOWN_ACTION");
  });

  test("edit and feedback payloads are limited", () => {
    const bad = (a: string, p: unknown, h: { type: string; actorId: string | null }[] = []) => {
      const r = core.applyAction(base, a, p, "a", h);
      return core.isPlannerError(r) ? r.error : null;
    };
    expect(bad("edit", { title: "x".repeat(121) })).toBe("BAD_PAYLOAD");
    expect(bad("edit", { concept: "x".repeat(601) })).toBe("BAD_PAYLOAD");
    expect(bad("edit", { title: "  " })).toBe("BAD_PAYLOAD");
    expect(bad("edit", { format: "gif" })).toBe("BAD_PAYLOAD");
    expect(bad("edit", { platform: "myspace" })).toBe("BAD_PAYLOAD");
    expect(bad("edit", { format: "carousel", platform: "youtube" })).toBe("BAD_PAYLOAD");
    expect(bad("edit", { title: "T" })).toBe("BAD_PAYLOAD");
    expect(bad("edit", { title: "x".repeat(120), concept: "y".repeat(600) })).toBeNull();
    expect(bad("feedback", { note: "hi" })).toBe("BAD_PAYLOAD");
    expect(bad("feedback", { helpful: true, note: "n".repeat(301) })).toBe("BAD_PAYLOAD");
    expect(bad("feedback", { helpful: false, note: "n".repeat(300) })).toBeNull();
    expect(bad("feedback", { helpful: true }, [{ type: "feedback", actorId: "a" }])).toBe("FEEDBACK_GIVEN");
    expect(bad("feedback", { helpful: true }, [{ type: "feedback", actorId: "b" }])).toBeNull();
    expect(bad("feedback", { helpful: true }, [])).toBeNull();
  });

  test("prefill reads nextAction, falls back to evidence ids, drops junk", () => {
    const r = { ...base, nextAction: JSON.stringify({ prefill: { topic: " Rice ", basedOn: ["p1", "p1", 3, "bad id!"] } }), evidence: "{}" };
    expect(core.prefillOf(r)).toEqual({ platform: "instagram", format: "video", topic: "Rice", title: "T", concept: "C", basedOn: ["p1"] });
    expect(core.prefillOf({ ...base, nextAction: "not json", evidence: JSON.stringify({ postIds: ["e1"] }) }).basedOn).toEqual(["e1"]);
  });
});

describe("R1240 act", () => {
  test("open -> edited -> done writes the row and the trail, newest first", async () => {
    const u = await user();
    const r = await rec(u.id);
    const e = await planner.act(u.id, r.id, "edit", { title: "Carousels on Tuesdays", format: "photo" }, owner(u.id));
    expect(e.recommendation.status).toBe("edited");
    expect(e.recommendation.title).toBe("Carousels on Tuesdays");
    expect(e.recommendation.format).toBe("photo");
    await age(r.id);
    expect((await planner.act(u.id, r.id, "done", null, owner(u.id))).recommendation.status).toBe("done");
    const trail = await planner.eventsFor(u.id, r.id);
    expect(trail.map((t) => t.type)).toEqual(["done", "edited"]);
    expect(trail[1].data).toMatchObject({ title: "Carousels on Tuesdays", format: "photo", role: "owner" });
    expect(trail[0].actorId).toBe(u.id);
  });

  test("an illegal transition is a 400 ILLEGAL_TRANSITION and changes nothing", async () => {
    const u = await user();
    const r = await rec(u.id, "done");
    expect(await err(planner.act(u.id, r.id, "accept", null, owner(u.id)))).toEqual({ status: 400, code: "ILLEGAL_TRANSITION" });
    expect((await db.recommendation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("done");
    expect(await db.recommendationEvent.count({ where: { recommendationId: r.id } })).toBe(0);
  });

  test("the same action by the same person within 5 s is a no-op; another person or later is not", async () => {
    const u = await user();
    const r = await rec(u.id);
    const a = await planner.act(u.id, r.id, "accept", null, owner(u.id));
    const b = await planner.act(u.id, r.id, "accept", null, owner(u.id));
    expect(a.deduped).toBe(false);
    expect(b.deduped).toBe(true);
    expect(b.prefill?.title).toBe("Make more carousels");
    expect(await db.recommendationEvent.count({ where: { recommendationId: r.id } })).toBe(1);
    // Another person accepting the same thing is a real (illegal) second accept.
    expect((await err(planner.act(u.id, r.id, "accept", null, { id: "someone-else", role: "manager" })))?.code).toBe("ILLEGAL_TRANSITION");
    await age(r.id);
    expect((await err(planner.act(u.id, r.id, "accept", null, owner(u.id))))?.code).toBe("ILLEGAL_TRANSITION");
    // An identical edit repeated quickly is a no-op, a different one is applied.
    const r2 = await rec(u.id);
    await planner.act(u.id, r2.id, "edit", { title: "One" }, owner(u.id));
    expect((await planner.act(u.id, r2.id, "edit", { title: "One" }, owner(u.id))).deduped).toBe(true);
    expect((await planner.act(u.id, r2.id, "edit", { title: "Two" }, owner(u.id))).recommendation.title).toBe("Two");
    expect(await db.recommendationEvent.count({ where: { recommendationId: r2.id } })).toBe(2);
  });

  test("save makes exactly one Idea, even across two saves", async () => {
    const u = await user();
    const r = await rec(u.id);
    const s1 = await planner.act(u.id, r.id, "save", null, owner(u.id));
    const s2 = await planner.act(u.id, r.id, "save", null, owner(u.id));
    expect(s1.ideaId).toBeTruthy();
    expect(s2.deduped).toBe(true);
    await age(r.id);
    expect((await err(planner.act(u.id, r.id, "save", null, owner(u.id))))?.code).toBe("ILLEGAL_TRANSITION");
    const ideas = await db.idea.findMany({ where: { userId: u.id } });
    expect(ideas.length).toBe(1);
    expect(ideas[0]).toMatchObject({ text: "Make more carousels: Carousels get twice the saves.", source: "suggestion", sourceRef: r.id });
    const trail = await planner.eventsFor(u.id, r.id);
    expect(trail[0].data).toMatchObject({ ideaId: ideas[0].id });
    // saved -> accepted still works.
    expect((await planner.act(u.id, r.id, "accept", null, owner(u.id))).recommendation.status).toBe("accepted");
  });

  test("accept returns the prefill the composer reads", async () => {
    const u = await user();
    const r = await rec(u.id);
    const a = await planner.act(u.id, r.id, "accept", null, owner(u.id));
    expect(a.prefill).toEqual({ platform: "instagram", format: "carousel", topic: "Recipes", title: "Make more carousels", concept: "Carousels get twice the saves.", basedOn: ["p1", "p2"] });
  });

  test("feedback works on a terminal recommendation, once per person, and is stored", async () => {
    const u = await user();
    const r = await rec(u.id, "rejected");
    const f = await planner.act(u.id, r.id, "feedback", { helpful: false, note: "Not my niche" }, owner(u.id));
    expect(f.recommendation.status).toBe("rejected");
    expect(JSON.parse(f.recommendation.feedback ?? "{}")).toMatchObject({ helpful: false, note: "Not my niche" });
    await age(r.id);
    expect((await err(planner.act(u.id, r.id, "feedback", { helpful: true }, owner(u.id))))?.code).toBe("FEEDBACK_GIVEN");
    expect((await planner.act(u.id, r.id, "feedback", { helpful: true }, { id: "teammate", role: "editor" })).deduped).toBe(false);
  });

  test("another owner's recommendation is a 404 for acting and for the trail", async () => {
    const [u, other] = [await user(), await user()];
    const r = await rec(u.id);
    expect((await err(planner.act(other.id, r.id, "accept", null, owner(other.id))))?.status).toBe(404);
    expect((await err(planner.eventsFor(other.id, r.id)))?.status).toBe(404);
    expect((await db.recommendation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("open");
  });
});

describe("R1240 routes", () => {
  const req = (method: string, path: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" } });

  test("an editor can act; the actor recorded is the real person; illegal is 400 ILLEGAL_TRANSITION; trail and list read", async () => {
    const o = await user();
    const editor = await user();
    const r = await rec(o.id);
    g.__r1240User = { ...o, role: "editor", joinedAt: o.createdAt, actor: { id: editor.id, name: editor.name, email: editor.email }, scope: null };
    const ok = await one.POST(req("POST", `/api/recommendations/${r.id}`, { action: "accept" }), { params: { id: r.id } });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { recommendation: { status: string }; prefill: { topic: string } };
    expect(body.recommendation.status).toBe("accepted");
    expect(body.prefill.topic).toBe("Recipes");
    const bad = await one.POST(req("POST", `/api/recommendations/${r.id}`, { action: "save" }), { params: { id: r.id } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe("ILLEGAL_TRANSITION");
    const trail = (await (await events.GET(req("GET", `/api/recommendations/${r.id}/events`), { params: { id: r.id } })).json()) as { events: { type: string; actorId: string; data: { role: string } }[] };
    expect(trail.events.map((e) => e.type)).toEqual(["accepted"]);
    expect(trail.events[0].actorId).toBe(editor.id);
    expect(trail.events[0].data.role).toBe("editor");
    const listed = (await (await list.GET(req("GET", "/api/recommendations?status=accepted&limit=500"), { params: {} })).json()) as { recommendations: { id: string }[] };
    expect(listed.recommendations.map((x) => x.id)).toContain(r.id);
    g.__r1240User = { ...editor, role: "owner", joinedAt: editor.createdAt, actor: null, scope: null };
    expect((await one.POST(req("POST", `/api/recommendations/${r.id}`, { action: "done" }), { params: { id: r.id } })).status).toBe(404);
  });
});
