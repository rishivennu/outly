/**
 * 1332: Infrastructure & Costs, Phase 5. A provider's day several times its usual week is a spike (variable spend
 * only, one alert per provider per day, warn or critical); recommendations are plain rules over the month that say
 * what they saw and what to do; warn and critical alerts also go to the alert email, info stays in the bell.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPIKE_DEFAULTS, addDays, detectSpikes, recommend, spikeAlert, type DaySpend, type InsightInput } from "../lib/costs/insights-core";

let db: typeof import("../lib/db").db;
let insights: typeof import("../lib/costs/insights");
let manual: typeof import("../lib/costs/manual");
const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8");
const P = "t1332-provider";

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  insights = await import("../lib/costs/insights");
  manual = await import("../lib/costs/manual");
  await db.costAlert.deleteMany({ where: { key: { startsWith: "spike:gemini:2026-03-" } } });
  await db.costAlert.deleteMany({ where: { key: { startsWith: "t1332:" } } });
  await db.costDaily.deleteMany({ where: { feature: "t1332" } });
});
afterAll(async () => {
  await db.costAlert.deleteMany({ where: { key: { startsWith: "spike:gemini:2026-03-" } } });
  await db.costAlert.deleteMany({ where: { key: { startsWith: "t1332:" } } });
  await db.costDaily.deleteMany({ where: { feature: "t1332" } });
  await db.$disconnect();
});

const week = (provider: string, from: string, perDay: number, source = "estimate"): DaySpend[] => Array.from({ length: 7 }, (_, i) => ({ day: addDays(from, i), provider, source, inrMinor: perDay }));

describe("1332 spikes (pure)", () => {
  const D = "2026-03-10";
  test("a day several times the median of the week before is a spike; critical past 5x", () => {
    const rows = [...week("gemini", "2026-03-03", 2000), { day: D, provider: "gemini", source: "estimate", inrMinor: 6000 }];
    const [s] = detectSpikes(rows, D);
    expect(s).toMatchObject({ provider: "gemini", day: D, inrMinor: 6000, baselineMinor: 2000, severity: "warn" });
    expect(s.ratio).toBe(3);
    expect(detectSpikes([...week("gemini", "2026-03-03", 2000), { day: D, provider: "gemini", source: "reported", inrMinor: 11000 }], D)[0].severity).toBe("critical");
  });

  test("below the floor, under the ratio, or an ordinary day: nothing", () => {
    expect(detectSpikes([...week("gemini", "2026-03-03", 100), { day: D, provider: "gemini", source: "estimate", inrMinor: 4000 }], D)).toEqual([]); // under ₹50
    expect(detectSpikes([...week("gemini", "2026-03-03", 5000), { day: D, provider: "gemini", source: "estimate", inrMinor: 12000 }], D)).toEqual([]); // 2.4x
    expect(detectSpikes([...week("gemini", "2026-03-03", 5000), { day: D, provider: "gemini", source: "estimate", inrMinor: 5000 }], D)).toEqual([]);
  });

  test("manual renewals and invoices are not spikes, and only count as variable baseline when they are variable", () => {
    expect(detectSpikes([{ day: D, provider: "vercel", source: "manual", inrMinor: 200000 }], D)).toEqual([]);
    expect(detectSpikes([{ day: D, provider: "vercel", source: "billed", inrMinor: 200000 }], D)).toEqual([]);
  });

  test("a provider with nothing in the week before needs the new-spend floor; missing days count as zero", () => {
    expect(detectSpikes([{ day: D, provider: "groq", source: "estimate", inrMinor: 15000 }], D)).toEqual([]);
    const [s] = detectSpikes([{ day: D, provider: "groq", source: "estimate", inrMinor: 25000 }], D);
    expect(s).toMatchObject({ provider: "groq", baselineMinor: 0, severity: "warn" });
    expect(s.ratio).toBe(Infinity);
    expect(detectSpikes([{ day: D, provider: "groq", source: "estimate", inrMinor: 120000 }], D)[0].severity).toBe("critical");
    // three quiet days then a busy one: median of (0,0,0,0,3000,3000,3000) is 0 -> new-spend rule applies
    const sparse = [...["2026-03-07", "2026-03-08", "2026-03-09"].map((day) => ({ day, provider: "x", source: "estimate", inrMinor: 3000 })), { day: D, provider: "x", source: "estimate", inrMinor: 30000 }];
    expect(detectSpikes(sparse, D)[0]).toMatchObject({ provider: "x", baselineMinor: 0 });
  });

  test("several providers sort by size; days other than the one asked for are ignored", () => {
    const rows = [...week("gemini", "2026-03-03", 1000), { day: D, provider: "gemini", source: "estimate", inrMinor: 9000 }, ...week("resend", "2026-03-03", 1000), { day: D, provider: "resend", source: "estimate", inrMinor: 40000 }, { day: "2026-03-11", provider: "groq", source: "estimate", inrMinor: 999999 }];
    expect(detectSpikes(rows, D).map((s) => s.provider)).toEqual(["resend", "gemini"]);
  });

  test("the alert names the provider, the day, the ratio and links to that day's ledger", () => {
    const a = spikeAlert({ provider: "gemini", day: D, inrMinor: 6000, baselineMinor: 2000, ratio: 3, severity: "warn" });
    expect(a.key).toBe(`spike:gemini:${D}`);
    expect(a.kind).toBe("spike");
    expect(a.title).toBe(`Google Gemini spent ₹60.00 on ${D}`); // fmtInr shows paise under ₹100
    expect(a.body).toContain("3.0x its usual day (₹20.00 median over the week before)");
    expect(a.href).toBe(`/admin/costs?from=${D}&to=${D}`);
    expect(spikeAlert({ provider: "groq", day: D, inrMinor: 25000, baselineMinor: 0, ratio: Infinity, severity: "warn" }).body).toContain("with nothing recorded in the week before");
    expect(SPIKE_DEFAULTS).toEqual({ floorMinor: 5000, newFloorMinor: 20000, ratio: 2.5, criticalRatio: 5 });
  });
});

const base = (over: Partial<InsightInput> = {}): InsightInput => ({
  month: { variableMtdMinor: 50000, dayOfMonth: 15, daysInMonth: 30, forecast: { projectedTotalMinor: 100000 } },
  totalMinor: 100000,
  bySource: { estimate: 20000, reported: 80000, billed: 0, manual: 0, forecast: 0 },
  byFeature: [],
  variableByProvider: { gemini: 30000 },
  budgets: [],
  recurring: [],
  connections: [],
  aiModels: [],
  fees: [],
  ...over,
});

describe("1332 recommendations (pure)", () => {
  test("a quiet month recommends nothing", () => {
    expect(recommend(base())).toEqual([]);
  });

  test("a budget on course to be exceeded is a warn, projected at this month's pace (total scope uses the forecast)", () => {
    const r = recommend(base({ budgets: [
      { id: "b1", name: "Everything", scope: "total", key: "", inrMinor: 80000, spentMinor: 50000, active: true },
      { id: "b2", name: "AI", scope: "category", key: "ai", inrMinor: 50000, spentMinor: 30000, active: true }, // 30000/15*30 = 60000 > 50000
      { id: "b3", name: "Email", scope: "category", key: "email", inrMinor: 50000, spentMinor: 20000, active: true }, // 40000: fine
      { id: "b4", name: "Off", scope: "total", key: "", inrMinor: 1000, spentMinor: 50000, active: false },
    ] }));
    expect(r.map((x) => x.id)).toEqual(["budget-pace:b1", "budget-pace:b2"]);
    expect(r[0].severity).toBe("warn");
    expect(r[0].title).toBe("Everything is on course for ₹1,000 against a ₹800 budget");
    expect(r[0].body).toContain("about ₹200 over");
    expect(r[1].title).toContain("₹600 against a ₹500 budget");
  });

  test("too early in the month to judge pace", () => {
    expect(recommend(base({ month: { variableMtdMinor: 5000, dayOfMonth: 2, daysInMonth: 30, forecast: { projectedTotalMinor: 900000 } }, budgets: [{ id: "b1", name: "All", scope: "total", key: "", inrMinor: 80000, spentMinor: 5000, active: true }] }))).toEqual([]);
  });

  test("a metered provider with no usage this month that still renews, after the first week", () => {
    const rec = [{ id: "r1", name: "Groq Dev", provider: "groq", monthlyInrMinor: 2500, active: true }, { id: "r2", name: "Gemini", provider: "gemini", monthlyInrMinor: 9000, active: true }, { id: "r3", name: "Domain", provider: "cloudflare", monthlyInrMinor: 100, active: true }, { id: "r4", name: "Old", provider: "groq", monthlyInrMinor: 100, active: false }];
    const r = recommend(base({ recurring: rec }));
    expect(r.map((x) => x.id)).toEqual(["idle:r1"]);
    expect(r[0]).toMatchObject({ severity: "info", saveMinor: 2500 });
    expect(r[0].title).toBe("No Groq (Whisper) usage recorded this month, but Groq Dev still renews");
    expect(recommend(base({ recurring: rec, month: { ...base().month, dayOfMonth: 5 } }))).toEqual([]);
  });

  test("two hosts at once: the saving is the cheaper one", () => {
    const r = recommend(base({ recurring: [{ id: "v", name: "Vercel Pro", provider: "vercel", monthlyInrMinor: 170000, active: true }, { id: "r", name: "Render Starter", provider: "render", monthlyInrMinor: 60000, active: true }], variableByProvider: { vercel: 1, render: 1 }, connections: [{ provider: "vercel", status: "ok" }, { provider: "render", status: "ok" }] }));
    expect(r.map((x) => x.id)).toEqual(["hosting-overlap"]);
    expect(r[0].saveMinor).toBe(60000);
    expect(r[0].body).toContain("Vercel (₹1,700 a month) and Render (₹600 a month)");
  });

  test("AI spend concentrated on a model several times the price of a cheaper one already in use", () => {
    const models = [
      { model: "gemini-2.5-pro", provider: "gemini", calls: 1000, inrMinor: 70000, perThousandCallsMinor: 70000, unpriced: false },
      { model: "gemini-2.5-flash", provider: "gemini", calls: 4000, inrMinor: 20000, perThousandCallsMinor: 5000, unpriced: false },
      { model: "kimi-k2", provider: "openrouter", calls: 500, inrMinor: 10000, perThousandCallsMinor: 20000, unpriced: false },
    ];
    const r = recommend(base({ aiModels: models }));
    expect(r.map((x) => x.id)).toEqual(["ai-mix:gemini-2.5-pro"]);
    expect(r[0].body).toContain("70% of AI spend, at ₹700 per 1k calls. gemini-2.5-flash already handles 4,000 calls at ₹50.00 per 1k.");
    expect(r[0].saveMinor).toBe(Math.round(35000 * (1 - 5000 / 70000)));
    expect(r[0].href).toBe("/admin/costs?view=ai");
    // top model under 60%, or no model at half the price: nothing
    expect(recommend(base({ aiModels: models.map((m) => ({ ...m, inrMinor: 30000 })) }))).toEqual([]);
    expect(recommend(base({ aiModels: [models[0], { ...models[1], perThousandCallsMinor: 40000 }] }))).toEqual([]);
    // unpriced rows never drive the rule
    expect(recommend(base({ aiModels: [{ ...models[0], unpriced: true }, models[1]] }))).toEqual([]);
  });

  test("card fees against UPI when cards carry a real share of the money", () => {
    const fees = [{ method: "card", feeMinor: 2360, amountMinor: 100000, count: 2 }, { method: "upi", feeMinor: 0, amountMinor: 100000, count: 4 }];
    const r = recommend(base({ fees }));
    expect(r.map((x) => x.id)).toEqual(["fees-method"]);
    expect(r[0].title).toBe("Card payments cost 2.4% in fees; UPI costs 0%");
    expect(r[0].body).toContain("carried 50% of the money");
    expect(r[0].saveMinor).toBe(2360);
    expect(r[0].href).toBe("/admin/payments");
    expect(recommend(base({ fees: [fees[0], { ...fees[1], amountMinor: 400000 }] }))).toEqual([]); // cards only 20%
    expect(recommend(base({ fees: [fees[0]] }))).toEqual([]); // no UPI to compare with
    expect(recommend(base({ fees: [{ ...fees[0], feeMinor: 300 }, fees[1]] }))).toEqual([]); // 0.3% apart: not worth a nudge
  });

  test("mostly estimates while a connectable provider in use is not connected", () => {
    const r = recommend(base({ bySource: { estimate: 80000, reported: 20000, billed: 0, manual: 0, forecast: 0 }, variableByProvider: { gemini: 1, supabase: 500, vercel: 1 }, recurring: [{ id: "v", name: "Vercel Pro", provider: "vercel", monthlyInrMinor: 170000, active: true }], connections: [{ provider: "vercel", status: "ok" }, { provider: "supabase", status: "error" }] }));
    expect(r.map((x) => x.id)).toEqual(["estimates-heavy"]);
    expect(r[0].body).toContain("80% of the range is estimated");
    expect(r[0].body).toContain("Connect Supabase under Provider connections");
    expect(recommend(base({ bySource: { estimate: 80000, reported: 20000, billed: 0, manual: 0, forecast: 0 }, variableByProvider: { gemini: 1, supabase: 500 }, connections: [{ provider: "supabase", status: "ok" }] }))).toEqual([]);
  });

  test("reading X costs more than posting to it, past ₹100", () => {
    expect(recommend(base({ byFeature: [{ key: "x-read", inrMinor: 15000 }, { key: "x-post", inrMinor: 9000 }] })).map((x) => x.id)).toEqual(["x-reads"]);
    expect(recommend(base({ byFeature: [{ key: "x-read", inrMinor: 9000 }, { key: "x-post", inrMinor: 1000 }] }))).toEqual([]);
    expect(recommend(base({ byFeature: [{ key: "x-read", inrMinor: 15000 }, { key: "x-post", inrMinor: 20000 }] }))).toEqual([]);
  });

  test("warn first, then by the size of the saving", () => {
    const r = recommend(base({
      budgets: [{ id: "b1", name: "All", scope: "total", key: "", inrMinor: 80000, spentMinor: 50000, active: true }],
      recurring: [{ id: "g", name: "Groq Dev", provider: "groq", monthlyInrMinor: 2500, active: true }, { id: "v", name: "Vercel", provider: "vercel", monthlyInrMinor: 170000, active: true }, { id: "r", name: "Render", provider: "render", monthlyInrMinor: 60000, active: true }],
      variableByProvider: { vercel: 1, render: 1 },
      connections: [{ provider: "vercel", status: "ok" }, { provider: "render", status: "ok" }],
      byFeature: [{ key: "x-read", inrMinor: 15000 }],
    }));
    expect(r.map((x) => x.id)).toEqual(["budget-pace:b1", "hosting-overlap", "idle:g", "x-reads"]);
  });
});

describe("1332 sweep + email (ledger)", () => {
  test("sweepSpikes reads the daily rollup for yesterday and raises one alert per provider per day", async () => {
    const now = new Date("2026-03-11T06:00:00Z"); // yesterday = 2026-03-10
    const mk = (day: string, inrMinor: number) => ({ day, provider: "gemini", category: "ai", feature: "t1332", source: "estimate", units: 1, inrMinor, count: 1 });
    await db.costDaily.createMany({ data: [...Array.from({ length: 7 }, (_, i) => mk(addDays("2026-03-03", i), 2000)), mk("2026-03-10", 6000)] });
    expect(await insights.sweepSpikes(now)).toBe(1);
    const a = await db.costAlert.findUnique({ where: { key: "spike:gemini:2026-03-10" } });
    expect(a).not.toBeNull();
    expect(a!.kind).toBe("spike");
    expect(a!.severity).toBe("warn");
    expect(a!.title).toBe("Google Gemini spent ₹60.00 on 2026-03-10");
    expect(await insights.sweepSpikes(now)).toBe(0); // same day again: already raised
  });

  test("the alert email is skipped cleanly without an address, and info alerts never try", async () => {
    const r = await insights.emailCostAlert({ title: "t1332 test", body: "x", href: "/admin/costs", severity: "warn" });
    expect(typeof r.sent).toBe("boolean");
    expect(["no alert email", "mocked", "sent", "failed", "queued", "skipped"].some((s) => r.status.includes(s)) || r.status.length > 0).toBe(true);
    expect(await manual.raiseAlert({ key: "t1332:info", kind: "renewal", severity: "info", title: "t1332 info" })).toBe(true);
    expect(await manual.raiseAlert({ key: "t1332:info", kind: "renewal", severity: "info", title: "t1332 info" })).toBe(false);
  });

  test("recommendationsFor runs against the real overview without throwing", async () => {
    const { overview } = await import("../lib/costs/overview");
    const o = await overview({});
    const recs = await insights.recommendationsFor(o);
    expect(Array.isArray(recs)).toBe(true);
    for (const r of recs) expect(["info", "warn"]).toContain(r.severity);
  });
});

describe("1332 wiring (source)", () => {
  test("the sweep raises spikes before the provider sync; warn/critical alerts go out by email", () => {
    const s = read("lib/costs/manual.ts");
    expect(s).toContain('alerts += await import("./insights").then((m) => m.sweepSpikes(now))');
    expect(s.indexOf("m.sweepSpikes(now)")).toBeLessThan(s.indexOf("m.syncAll(now)"));
    expect(s).toContain('if ((a.severity ?? "warn") !== "info") await import("./insights").then((m) => m.emailCostAlert(a)).catch(() => {});');
    expect(s.indexOf('await adminEvent("costs", a.title')).toBeLessThan(s.indexOf("m.emailCostAlert(a)"));
  });

  test("the email goes to the System Health alert address with its own kind", () => {
    const s = read("lib/costs/insights.ts");
    expect(s).toContain('const { watchdogConfig } = await import("../health/config");');
    expect(s).toContain('if (!cfg.alertEmail) return { sent: false, status: "no alert email" };');
    expect(s).toContain('kind: "costs"');
    expect(read("lib/email/index.ts")).toContain('| "workshop" | "costs";');
  });

  test("the dashboard shows recommendations above alerts and only on the main view", () => {
    const s = read("app/admin/(panel)/costs/page.tsx");
    expect(s).toContain('import { recommendationsFor } from "@/lib/costs/insights";');
    expect(s).toContain('view === "" ? recommendationsFor(o).catch(() => [] as Recommendation[]) : ([] as Recommendation[]),');
    expect(s).toContain("<InsightsCard items={recs} />");
    expect(s.indexOf("<InsightsCard items={recs} />")).toBeLessThan(s.indexOf("<AlertsCard items={o.alerts} />"));
    expect(s).toContain('{r.severity === "warn" ? "Act" : "Consider"}');
    expect(read("components/admin/costs/CostsPanel.tsx")).toContain("a provider whose day was several times its usual. Warn and critical ones also go to the System Health alert email.");
  });
});
