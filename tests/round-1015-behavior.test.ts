/** Admin "User behavior": the stats snapshot, the anonymiser, Gemini result coercion and version history. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let b: typeof import("../lib/admin/behavior");
let db: typeof import("../lib/db").db;
let env: typeof import("../lib/env").env;

beforeAll(async () => {
  b = await import("../lib/admin/behavior");
  db = (await import("../lib/db")).db;
  env = (await import("../lib/env")).env;
}, 60_000);

const NOW = new Date("2026-10-15T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const key = (n: number) => day(n).toISOString().slice(0, 10);

function input(): import("../lib/admin/behavior").BehaviorInput {
  const users = [
    { id: "a", name: "Ana", email: "ana@x.dev", createdAt: day(40), lastActiveAt: day(0), weeklyReport: true },
    { id: "b", name: "Ben", email: "ben@x.dev", createdAt: day(20), lastActiveAt: day(19), weeklyReport: false },
    { id: "c", name: "Cy", email: "cy@x.dev", createdAt: day(2), lastActiveAt: day(2), weeklyReport: true },
    { id: "d", name: "Di", email: "di@x.dev", createdAt: day(100), lastActiveAt: null, weeklyReport: true },
  ];
  const activity = [
    ...Array.from({ length: 12 }, (_, i) => ({ userId: "a", day: key(i) })),
    { userId: "a", day: key(39) },
    { userId: "b", day: key(20) },
    { userId: "b", day: key(19) },
    { userId: "c", day: key(2) },
  ];
  return {
    users,
    activity,
    accounts: [{ userId: "a", platform: "youtube", status: "connected" }, { userId: "a", platform: "instagram", status: "needs_reconnect" }, { userId: "b", platform: "youtube", status: "connected" }],
    mediaUsers: ["a", "b"],
    postCounts: [{ userId: "a", status: "published", count: 3 }, { userId: "a", status: "draft", count: 1 }, { userId: "b", status: "draft", count: 2 }],
    firstPublish: [{ userId: "a", at: new Date(day(40).getTime() + 5 * 3_600_000) }],
    posts: [
      { userId: "a", status: "published", createdAt: day(3), publishedAt: day(3), scheduledAt: day(3), requireApproval: false },
      { userId: "a", status: "draft", createdAt: day(1), publishedAt: null, scheduledAt: null, requireApproval: true },
      { userId: "b", status: "draft", createdAt: day(19), publishedAt: null, scheduledAt: null, requireApproval: false },
    ],
    targets: [
      { platform: "youtube", platformStatus: "published", practice: false, errorCode: null, userId: "a" },
      { platform: "youtube", platformStatus: "failed", practice: false, errorCode: "QUOTA", userId: "a" },
      { platform: "x", platformStatus: "published", practice: true, errorCode: null, userId: "a" },
    ],
    paid: [{ userId: "a", plan: "Creator" }],
  };
}

describe("computeBehavior", () => {
  test("funnel is nested and monotonic", () => {
    const s = b.computeBehavior(input(), 30, NOW);
    expect(s.funnel.map((f) => f.count)).toEqual([4, 2, 2, 2, 1, 1]);
    for (let i = 1; i < s.funnel.length; i++) expect(s.funnel[i].count).toBeLessThanOrEqual(s.funnel[i - 1].count);
    expect(s.funnel[4].pct).toBe(0.25);
  });

  test("actives, segments and retention", () => {
    const s = b.computeBehavior(input(), 30, NOW);
    expect(s.totals).toMatchObject({ users: 4, dau: 1, wau: 2, mau: 3, paying: 1, weeklyReportOptIn: 3 });
    const seg = Object.fromEntries(s.segments.map((x) => [x.key, x.users]));
    expect(seg).toEqual({ new: 1, power: 1, regular: 0, casual: 1, dormant: 1 });
    expect(s.segments.reduce((t, x) => t + x.users, 0)).toBe(4);
    const d1 = s.retention.find((r) => r.key === "d1")!;
    expect(d1.eligible).toBe(4);
    expect(d1.retained).toBe(2); // a (day 39) and b (day 19)
    const d30 = s.retention.find((r) => r.key === "d30")!;
    expect(d30.eligible).toBe(2); // a and d are 30+ days old
    expect(d30.retained).toBe(1);
  });

  test("platforms skip rehearsals; posts, errors and paid split", () => {
    const s = b.computeBehavior(input(), 30, NOW);
    const yt = s.platforms.find((p) => p.platform === "youtube")!;
    expect(yt).toMatchObject({ connected: 2, targets: 2, published: 1, failed: 1, successRate: 0.5 });
    expect(s.platforms.find((p) => p.platform === "instagram")!.needsReconnect).toBe(1);
    expect(s.platforms.find((p) => p.platform === "x")!.targets).toBe(0);
    expect(s.posts).toMatchObject({ inRange: 3, creators: 2, practiceTargets: 1, medianHoursToFirstPublish: 5 });
    expect(s.errors).toEqual([{ code: "QUOTA", count: 1 }]);
    expect(s.plans.paidUsers).toBe(1);
    expect(s.plans.paidAvgActiveDays).toBe(12);
    expect(s.series).toHaveLength(30);
    expect(s.cohorts).toHaveLength(8);
    expect(s.topUsers[0].id).toBe("a");
  });

  test("the model snapshot carries no names, emails or ids", () => {
    const snap = JSON.stringify(b.anonymise(b.computeBehavior(input(), 30, NOW)));
    for (const leak of ["Ana", "ana@x.dev", "ben@x.dev", "\"id\""]) expect(snap).not.toContain(leak);
    expect(snap).toContain("topUsersShape");
  });
});

describe("normaliseResult", () => {
  test("coerces enums, caps lists and strips em-dashes", () => {
    const r = b.normaliseResult({ headline: "Creators publish \u2014 then vanish", summary: "x", health: "great", confidence: "high", insights: Array.from({ length: 12 }, (_, i) => ({ title: `t${i}`, detail: "d", impact: "huge" })), risks: [null, { title: "r" }], changes: ["c", 4] })!;
    expect(r.headline).toBe("Creators publish, then vanish");
    expect(r.health).toBe("steady");
    expect(r.confidence).toBe("high");
    expect(r.insights).toHaveLength(8);
    expect(r.insights[0].impact).toBe("medium");
    expect(r.risks).toHaveLength(1);
    expect(r.changes).toEqual(["c"]);
    expect(b.normaliseResult({})).toBeNull();
    expect(b.normaliseResult("nope")).toBeNull();
  });
});

describe("runAnalysis keeps every version", () => {
  const realFetch = globalThis.fetch;
  let prompts: string[] = [];
  afterAll(() => {
    globalThis.fetch = realFetch;
    (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = "";
  });

  test("no key: clear 503, nothing saved", async () => {
    (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = "";
    await expect(b.runAnalysis({ rangeDays: 30, by: "T" })).rejects.toMatchObject({ status: 503, code: "NO_AI" });
    expect(await db.behaviorAnalysis.count()).toBe(0);
  });

  test("two runs make v1 and v2; v2 is told about v1; history lists both", async () => {
    (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = "test-key";
    await db.user.create({ data: { name: "Behave Person", email: `behave-${Date.now()}@secret.dev`, passwordHash: "x" } });
    let n = 0;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      prompts.push(String(init.body));
      n++;
      const text = JSON.stringify({ headline: `Read number ${n}`, summary: "People sign up and explore.", health: "at_risk", confidence: "low", changes: ["Users up by 0"] });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    }) as typeof fetch;

    const v1 = await b.runAnalysis({ rangeDays: 30, by: "Tester", focus: "  why no publishing?  " });
    const v2 = await b.runAnalysis({ rangeDays: 7, by: "Tester" });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v1.model).toBe("gemini-flash-latest");
    expect(v1.focus).toBe("why no publishing?");
    expect(v1.result.changes).toEqual([]); // first ever run has nothing to compare
    expect(v2.result.changes).toEqual(["Users up by 0"]);
    expect(prompts[1]).toContain("previous analysis was version 1");
    expect(prompts.join(" ")).not.toContain("@secret.dev");

    const list = await b.listAnalyses();
    expect(list.total).toBe(2);
    expect(list.items.map((i) => i.version)).toEqual([2, 1]);
    expect(list.items[1].headline).toBe("Read number 1");
    const page = await b.listAnalyses({ before: 2, take: 1 });
    expect(page.items.map((i) => i.version)).toEqual([1]);
    expect(page.more).toBe(false);

    const full = await b.getAnalysis(v1.id);
    expect(full?.result.health).toBe("at_risk");
    expect(full?.stats.rangeDays).toBe(30);
    expect(await b.getAnalysis("missing")).toBeNull();
  });

  test("an unusable answer saves nothing", async () => {
    (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = "test-key";
    globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 })) as typeof fetch;
    await expect(b.runAnalysis({ rangeDays: 30, by: "T" })).rejects.toMatchObject({ status: 502 });
    expect(await db.behaviorAnalysis.count()).toBe(2);
    prompts = [];
  });
});
