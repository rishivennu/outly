/** 1166: User behavior counts one cohort per funnel, waits for complete retention windows, and its segments add up. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cohortFunnel, retentionRows, segmentUsers, waitlistStage, weekdayRhythm, weeklyCohorts, withPeople, powerThreshold, type FunnelEvents } from "../lib/admin/activation";
import { anonymise, computeBehavior, type BehaviorInput } from "../lib/admin/behavior";
import { adminEmail } from "../lib/admin/privacy";

const src = (f: string) => readFileSync(join(import.meta.dir, "..", f), "utf8").replace(/\r\n/g, "\n");
const NOW = new Date("2026-11-17T12:00:00Z"); // a Tuesday
const DAY = 86_400_000;
const at = (n: number) => new Date(NOW.getTime() - n * DAY);
const key = (n: number) => at(n).toISOString().slice(0, 10);
const m = (id: string, ago: number) => ({ id, name: id.toUpperCase(), email: `${id}@x.dev`, createdAt: at(ago) });
const ev = (o: Partial<Record<keyof FunnelEvents, string[]>>): FunnelEvents => ({ connected: new Set(o.connected), uploaded: new Set(o.uploaded), created: new Set(o.created), published: new Set(o.published), paid: new Set(o.paid) });
const meta = { cohort: "range" as const, label: "t", from: key(29), to: key(0) };

describe("activation funnel", () => {
  test("nested: later steps never exceed earlier ones, even when people skip steps", () => {
    const members = [m("a", 1), m("b", 2), m("c", 3), m("d", 4)];
    // d published and paid without connecting or uploading: skipped, so not counted past step 1
    const f = cohortFunnel(members, ev({ connected: ["a", "b", "c"], uploaded: ["a", "b"], created: ["a", "b", "d"], published: ["a", "d"], paid: ["a", "d"] }), meta);
    expect(f.steps.map((s) => s.count)).toEqual([4, 3, 2, 2, 1, 1]);
    for (let i = 1; i < f.steps.length; i++) expect(f.steps[i].count).toBeLessThanOrEqual(f.steps[i - 1].count);
    expect(f.steps.map((s) => s.dropped)).toEqual([0, 1, 1, 0, 1, 0]);
    expect(f.steps.map((s) => s.skipped)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(f.steps[1].stepRate).toBe(0.75);
    expect(f.steps[0].stepRate).toBeNull();
    expect(f.steps[4].pctOfStart).toBe(0.25);
    // inspectable: who reached the step and who stopped right before it
    expect(f.steps[1].stopped.map((p) => p.id)).toEqual(["d"]);
    expect(f.steps[2].stopped.map((p) => p.id)).toEqual(["c"]);
    expect(f.steps[5].reached.map((p) => p.id)).toEqual(["a"]);
  });

  test("an empty cohort is zero everywhere, never NaN", () => {
    const f = cohortFunnel([], ev({}), meta);
    expect(f.size).toBe(0);
    for (const s of f.steps) expect([s.count, s.pctOfStart, s.dropped]).toEqual([0, 0, 0]);
  });

  test("people lists are capped and newest first", () => {
    const members = Array.from({ length: 30 }, (_, i) => m(`u${i}`, i));
    const f = cohortFunnel(members, ev({}), meta, 5);
    expect(f.steps[0].reached.map((p) => p.id)).toEqual(["u0", "u1", "u2", "u3", "u4"]);
    expect(f.steps[1].stopped).toHaveLength(5);
    expect(f.steps[1].dropped).toBe(30);
  });

  test("the waitlist is its own stage, matched to accounts by email whatever the case", () => {
    const w = waitlistStage([{ email: "A@x.dev" }, { email: "b@x.dev" }, { email: "zed@x.dev" }, { email: "a@x.dev" }], ["a@x.dev", "b@x.dev", "c@x.dev"], ["a@x.dev"]);
    expect(w).toEqual({ joined: 3, withAccount: 2, inCohort: 1 });
  });

  test("the range cohort only holds people who signed up in the range; the waitlist never enters the funnel", () => {
    const input: BehaviorInput = {
      users: [
        { id: "old", name: "Old", email: "old@x.dev", createdAt: at(60), lastActiveAt: null, weeklyReport: false },
        { id: "new", name: "New", email: "new@x.dev", createdAt: at(3), lastActiveAt: null, weeklyReport: false },
      ],
      activity: [],
      accounts: [{ userId: "old", platform: "youtube", status: "connected" }],
      mediaUsers: [],
      postCounts: [{ userId: "old", status: "published", count: 1 }],
      firstPublish: [],
      posts: [],
      targets: [],
      paid: [],
      publishers: [],
      waitlist: [{ email: "new@x.dev", createdAt: at(5) }, { email: "w@x.dev", createdAt: at(2) }],
    };
    const s = computeBehavior(input, 30, NOW);
    expect(s.activation.range.size).toBe(1);
    expect(s.activation.range.steps[0].count).toBe(1);
    expect(s.activation.all.size).toBe(2);
    expect(s.activation.waitlist).toEqual({ joined: 2, withAccount: 1, inCohort: 1 });
    // "published" is a real publish: post status alone (practice runs too) no longer counts
    expect(s.activation.all.steps.find((x) => x.key === "publish")!.count).toBe(0);
    expect(s.funnel.find((x) => x.key === "publish")!.count).toBe(0);
    expect(s.timezone).toBe("UTC");
    expect(s.rangeStart).toBe(key(29));
  });

  test("roles that cannot open user records get counts only; others get masked addresses", () => {
    const s = computeBehavior({ users: [{ id: "a", name: "Ana", email: "ana@example.com", createdAt: at(1), lastActiveAt: null, weeklyReport: false }], activity: [], accounts: [], mediaUsers: [], postCounts: [], firstPublish: [], posts: [], targets: [], paid: [] }, 7, NOW);
    const hidden = withPeople(s.activation, null);
    expect(hidden.peopleShown).toBe(false);
    for (const st of [...hidden.range.steps, ...hidden.all.steps]) expect(st.reached.length + st.stopped.length).toBe(0);
    expect(hidden.range.steps[0].count).toBe(1);
    const masked = withPeople(s.activation, (e) => adminEmail(e, "support"));
    expect(masked.range.steps[0].reached[0].email).toBe("an****@example.com");
    expect(JSON.stringify(masked)).not.toContain("ana@example.com");
    // the original (cached) stats are not changed
    expect(s.activation.range.steps[0].reached[0].email).toBe("ana@example.com");
  });

  test("the Gemini snapshot keeps the funnel counts and drops every person", () => {
    const s = computeBehavior({ users: [{ id: "a", name: "Ana", email: "ana@example.com", createdAt: at(1), lastActiveAt: null, weeklyReport: false }], activity: [], accounts: [], mediaUsers: [], postCounts: [], firstPublish: [], posts: [], targets: [], paid: [] }, 7, NOW);
    const snap = anonymise(s);
    const txt = JSON.stringify(snap);
    for (const leak of ["Ana", "ana@example.com", "reached", "stopped"]) expect(txt).not.toContain(leak);
    expect(snap.activation.range.steps[0].count).toBe(1);
  });

  test("the page gates people on the server by role", () => {
    const p = src("app/admin/(panel)/behavior/page.tsx");
    expect(p).toContain('const people = can(admin.role, "users");');
    expect(p).toContain("activation: withPeople(raw.activation, people ? (e) => adminEmail(e, admin.role) : null)");
    expect(p).toContain("topUsers: people ? raw.topUsers.map");
  });
});

describe("retention", () => {
  const active = (days: Record<string, string[]>) => (id: string, from: string, to: string) => (days[id] ?? []).some((d) => d >= from && d <= to);

  test("a window that has not ended is not yet measurable, never 0%", () => {
    // joined yesterday: day 1 is today, still running
    const r = retentionRows([{ id: "a", createdAt: at(1) }], active({}), key(0));
    for (const row of r) {
      expect(row.eligible).toBe(0);
      expect(row.measurable).toBe(false);
      expect(row.pending).toBe(1);
    }
  });

  test("day one, week one and month one use their exact day windows", () => {
    const people = [{ id: "a", createdAt: at(40) }, { id: "b", createdAt: at(10) }, { id: "c", createdAt: at(3) }];
    const r = retentionRows(people, active({ a: [key(39), key(15)], b: [key(5)], c: [key(2)] }), key(0));
    const by = Object.fromEntries(r.map((x) => [x.key, x]));
    // day 1: a (day 39 = day 1), c (day 2 = day 1); b was not back on day 1
    expect([by.d1.eligible, by.d1.retained]).toEqual([3, 2]);
    // week 1 needs day 7 to be over: a and b only; b came back on day 5
    expect([by.w1.eligible, by.w1.retained, by.w1.pending]).toEqual([2, 2, 1]);
    // month 1 (days 8 to 30) needs day 30 over: only a; a was active on day 25
    expect([by.d30.eligible, by.d30.retained, by.d30.pending]).toEqual([1, 1, 2]);
  });

  test("weekly cohorts: weeks not started are null, the running week is marked partial", () => {
    const rows = weeklyCohorts([{ id: "a", createdAt: at(1) }, { id: "b", createdAt: at(8) }], active({ a: [key(0)] }), NOW, 3);
    const thisWeek = rows[2];
    expect(thisWeek.size).toBe(1);
    expect(thisWeek.weeks[0]).toBe(1);
    expect(thisWeek.partial).toBe(0);
    expect(thisWeek.weeks.slice(1)).toEqual([null, null]);
    const lastWeek = rows[1];
    expect(lastWeek.weeks).toEqual([0, 0, null]);
    expect(lastWeek.active).toEqual([0, 0, null]);
    expect(lastWeek.partial).toBe(1);
    expect(rows[0].size).toBe(0);
    expect(rows[0].weeks).toEqual([null, null, null]);
  });
});

describe("segments", () => {
  test("mutually exclusive in a stated order, and they add up to every account", () => {
    const today = key(0);
    const people = [
      { createdAt: at(2), activeDays: 20 }, // new beats power
      { createdAt: at(6), activeDays: 0 }, // still new (6 days before today)
      { createdAt: at(7), activeDays: 0 }, // dormant: 7 days is outside "this week"
      { createdAt: at(50), activeDays: 8 },
      { createdAt: at(50), activeDays: 7 },
      { createdAt: at(50), activeDays: 3 },
      { createdAt: at(50), activeDays: 2 },
      { createdAt: at(50), activeDays: 1 },
    ];
    const s = segmentUsers(people, 30, today);
    expect(Object.fromEntries(s.map((x) => [x.key, x.users]))).toEqual({ new: 2, power: 1, regular: 2, casual: 2, dormant: 1 });
    expect(s.reduce((t, x) => t + x.users, 0)).toBe(people.length);
    expect(s.reduce((t, x) => t + x.share, 0)).toBeCloseTo(1, 2);
    expect(powerThreshold(30)).toBe(8);
    expect(powerThreshold(7)).toBe(4);
    expect(segmentUsers([], 7, today).find((x) => x.key === "regular")!.description).toBe("Active on 3 days in the range");
  });
});

describe("weekly rhythm", () => {
  test("averages per weekday occurrence so 5-Monday months do not look busier", () => {
    const start = "2026-11-02"; // Monday
    const end = "2026-11-10"; // Tuesday, so Mon and Tue appear twice
    const w = weekdayRhythm(new Map([["2026-11-02", 4], ["2026-11-09", 2], ["2026-11-04", 3]]), start, end);
    const mon = w.find((d) => d.day === "Mon")!;
    expect(mon).toEqual({ day: "Mon", active: 6, days: 2, avg: 3 });
    expect(w.find((d) => d.day === "Wed")).toEqual({ day: "Wed", active: 3, days: 1, avg: 3 });
    expect(w.reduce((t, d) => t + d.days, 0)).toBe(9);
  });
});

describe("behavior screen", () => {
  test("states the timezone, defines each number and never shows a missing window as 0%", () => {
    const b = src("components/admin/BehaviorBreakdown.tsx");
    expect(b).toContain('"Not yet measurable"');
    expect(b).toContain("<Hint text={r.rule}");
    expect(b).toContain("of {n(s.totals.users)} accounts");
    expect(b).toContain("is not the same as 0%");
    const v = src("components/admin/BehaviorView.tsx");
    expect(v).toContain('<ReportMeta source="Outlly data"');
    const f = src("components/admin/ActivationFunnel.tsx");
    expect(f).toContain("Waitlist, counted on its own");
    expect(f).toContain("skipped an earlier step");
  });
});
