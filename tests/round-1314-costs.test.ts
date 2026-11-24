/**
 * 1314: Infrastructure & Costs, Phase 1. The ledger records the original currency and the FX it was converted
 * at, rolls up per day, dedupes on `ref`, and the manual side (bills, recurring expenses, budgets, unit prices,
 * alerts) behaves: duplicates refused, renewals booked once, budget steps alerted once per month, exports are CSV.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crossedThresholds, forecastMonth, monthlyShare, parseThresholds, pctOf, toCsv, toInrMinor, fmtInr, PROVIDERS, providerOf } from "../lib/costs/core";

let db: typeof import("../lib/db").db;
let ledger: typeof import("../lib/costs/ledger");
let manual: typeof import("../lib/costs/manual");
let ov: typeof import("../lib/costs/overview");
let prices: typeof import("../lib/costs/prices");
const by = { login: "finance@outlly.test" };
const status = async (p: Promise<unknown>) => p.then(() => 0, (e) => e as { status?: number; code?: string });

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  ledger = await import("../lib/costs/ledger");
  manual = await import("../lib/costs/manual");
  ov = await import("../lib/costs/overview");
  prices = await import("../lib/costs/prices");
});
afterAll(async () => {
  await db.$disconnect();
});

describe("1314 core", () => {
  test("money helpers keep integers and recorded FX", () => {
    expect(toInrMinor(2000, 94.71)).toBe(189420);
    expect(toInrMinor(100, 1)).toBe(100);
    expect(monthlyShare(12000, "yearly")).toBe(1000);
    expect(monthlyShare(700, "monthly")).toBe(700);
    expect(pctOf(50, 200)).toBe(25);
    expect(pctOf(5, 0)).toBe(100);
    expect(fmtInr(123456)).toBe("₹1,235");
    expect(fmtInr(1550)).toBe("₹15.50");
  });
  test("thresholds parse, dedupe and report what was crossed", () => {
    expect(parseThresholds("50, 75,90,100,100,abc,0")).toEqual([50, 75, 90, 100]);
    expect(crossedThresholds(92, [50, 75, 90, 100])).toEqual([50, 75, 90]);
    expect(crossedThresholds(92, [50, 75, 90, 100], new Set([50, 75]))).toEqual([90]);
  });
  test("the forecast scales the run rate and labels confidence", () => {
    const f = forecastMonth({ variableMtdMinor: 3000, recurringRemainingMinor: 500, dayOfMonth: 10, daysInMonth: 30 });
    expect(f.projectedVariableMinor).toBe(9000);
    expect(f.projectedTotalMinor).toBe(9500);
    expect(f.confidence).toBe("medium");
    expect(forecastMonth({ variableMtdMinor: 0, recurringRemainingMinor: 0, dayOfMonth: 1, daysInMonth: 31 }).confidence).toBe("low");
  });
  test("CSV quotes commas, quotes and newlines", () => {
    expect(toCsv(["a", "b"], [["x,y", 'he said "hi"'], [1, null]])).toBe('a,b\r\n"x,y","he said ""hi"""\r\n1,\r\n');
  });
  test("providers are only what Outlly uses and 'other' is the fallback", () => {
    expect(PROVIDERS.map((p) => p.id)).toContain("gemini");
    expect(providerOf("made-up").id).toBe("other");
  });
});

describe("1314 ledger", () => {
  test("records original currency, FX and INR, rolls up per day, and dedupes on ref", async () => {
    const at = new Date("2026-11-03T10:00:00Z");
    // feature "t1314" keeps these rows apart from what other test files meter through recordCost on the same day (the DB is shared on Windows)
    const ev = await ledger.recordCostEvent({ provider: "gemini", category: "ai", feature: "t1314", userId: "u1", units: 1200, unit: "token", amountMinor: 50, currency: "USD", source: "estimate", ref: "t1314:a", at });
    expect(ev).not.toBeNull();
    expect(ev!.currency).toBe("USD");
    expect(ev!.fxToInr).toBeGreaterThan(50);
    expect(ev!.inrMinor).toBeCloseTo(50 * ev!.fxToInr, 6);
    expect(ev!.day).toBe("2026-11-03");
    const dup = await ledger.recordCostEvent({ provider: "gemini", category: "ai", feature: "t1314", amountMinor: 50, currency: "USD", ref: "t1314:a", at });
    expect(dup).toBeNull();
    await ledger.recordCostEvent({ provider: "gemini", category: "ai", feature: "t1314", userId: "u2", units: 800, unit: "token", amountMinor: 30, currency: "USD", at });
    const daily = await db.costDaily.findUnique({ where: { day_provider_category_feature_source: { day: "2026-11-03", provider: "gemini", category: "ai", feature: "t1314", source: "estimate" } } });
    expect(daily!.count).toBe(2);
    expect(daily!.units).toBe(2000);
    expect(daily!.inrMinor).toBeCloseTo(ev!.inrMinor + 30 * ev!.fxToInr, 6);
    expect((await ledger.trackingSince())! <= "2026-11-03").toBe(true);
  });
  test("zero amounts are not booked", async () => {
    expect(await ledger.recordCostEvent({ provider: "resend", category: "email", amountMinor: 0 })).toBeNull();
  });
  test("recordUsage prices units at the unit price in force and keeps the price id", async () => {
    const ev = await ledger.recordUsage({ provider: "gemini", sku: "gemini-2.5-flash:output", units: 1_000_000, feature: "captions", at: new Date("2026-11-04T00:00:00Z") });
    expect(ev).not.toBeNull();
    expect(ev!.amountMinor).toBeCloseTo(250, 6); // $2.50 per million
    expect(ev!.unitPriceId).toBeTruthy();
    expect(ev!.currency).toBe("USD");
    expect(await ledger.recordUsage({ provider: "gemini", sku: "no-such-sku", units: 5 })).toBeNull();
  });
  test("economics bridge books 1147 categories to the right provider and feature", async () => {
    const ev = await ledger.recordEconomicsUse({ userId: "u3", category: "transcription", units: 2, now: new Date("2026-11-05T00:00:00Z") });
    expect(ev).not.toBeNull();
    expect(ev!.provider).toBe("gemini");
    expect(ev!.feature).toBe("captions");
    expect(ev!.currency).toBe("INR");
    expect(ev!.inrMinor).toBe(ev!.amountMinor);
    expect(ev!.inrMinor).toBeGreaterThan(0);
  });
});

describe("1314 unit prices", () => {
  test("a manual override starts a new row and ends the old one, history kept", async () => {
    const before = await prices.priceFor("gemini", "gemini-2.5-flash:input", new Date("2026-01-01T00:00:00Z"));
    expect(before!.source).toBe("seed");
    await manual.createPrice({ provider: "gemini", sku: "gemini-2.5-flash:input", unit: "token", price: 0.0000004, currency: "USD", effectiveFrom: "2026-12-01", note: "test" }, by);
    const old = await prices.priceFor("gemini", "gemini-2.5-flash:input", new Date("2026-06-01T00:00:00Z"));
    const now = await prices.priceFor("gemini", "gemini-2.5-flash:input", new Date("2026-12-15T00:00:00Z"));
    expect(old!.id).toBe(before!.id);
    expect(old!.effectiveTo?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(now!.source).toBe("manual");
    expect(now!.price).toBeCloseTo(0.0000004, 10);
  });
});

describe("1314 manual entries", () => {
  test("a bill books a billed ledger row, refuses duplicates, and removal takes the row back out", async () => {
    const bill = await manual.createBill({ provider: "vercel", invoiceId: "INV-1", periodStart: "2026-10-01", periodEnd: "2026-10-31", amountMinor: 2000, currency: "USD" }, by);
    expect(bill.inrMinor).toBe(Math.round(2000 * bill.fxToInr));
    const ev = await db.costEvent.findUnique({ where: { ref: `bill:${bill.id}` } });
    expect(ev?.source).toBe("billed");
    expect(ev?.day).toBe("2026-10-31");
    const dup = await status(manual.createBill({ provider: "vercel", invoiceId: "INV-1", periodStart: "2026-10-01", periodEnd: "2026-10-31", amountMinor: 2000 }, by));
    expect(dup).toMatchObject({ status: 409 });
    const bad = await status(manual.createBill({ provider: "vercel", invoiceId: "INV-2", periodStart: "2026-10-31", periodEnd: "2026-10-01", amountMinor: 2000 }, by));
    expect(bad).toMatchObject({ status: 400 });
    await manual.deleteBill(bill.id, by);
    expect(await db.costEvent.findUnique({ where: { ref: `bill:${bill.id}` } })).toBeNull();
    const daily = await db.costDaily.findUnique({ where: { day_provider_category_feature_source: { day: "2026-10-31", provider: "vercel", category: "hosting", feature: "platform", source: "billed" } } });
    expect(daily?.inrMinor ?? 0).toBe(0);
  });
  test("the sweep books due renewals once, advances the date, and warns a week ahead", async () => {
    const r = await manual.createRecurring({ name: "Render Starter", provider: "render", category: "hosting", amountMinor: 700, currency: "USD", cadence: "monthly", startsAt: "2026-09-10", nextRenewal: "2026-09-10" }, by);
    const now = new Date("2026-11-12T00:00:00Z");
    const first = await manual.sweepCosts(now);
    expect(first.booked).toBe(3); // Sep 10, Oct 10, Nov 10
    const again = await manual.sweepCosts(now);
    expect(again.booked).toBe(0);
    const row = await db.recurringExpense.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.nextRenewal.toISOString()).toBe("2026-12-10T00:00:00.000Z");
    expect(await db.costEvent.count({ where: { ref: { startsWith: `recurring:${r.id}:` } } })).toBe(3);
    const soon = await manual.sweepCosts(new Date("2026-12-05T00:00:00Z"));
    expect(soon.alerts).toBe(1);
    const alert = await db.costAlert.findUnique({ where: { key: `renewal:${r.id}:2026-12-10` } });
    expect(alert?.kind).toBe("renewal");
    expect((await manual.sweepCosts(new Date("2026-12-06T00:00:00Z"))).alerts).toBe(0); // same key, no second alert
  });
  test("a yearly expense that does not auto-renew is booked once then goes inactive", async () => {
    const r = await manual.createRecurring({ name: "Domain", provider: "cloudflare", category: "domain", amountMinor: 1000, currency: "USD", cadence: "yearly", startsAt: "2026-01-15", autoRenew: false }, by);
    await manual.sweepCosts(new Date("2026-02-01T00:00:00Z"));
    const row = await db.recurringExpense.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.active).toBe(false);
    expect(row.nextRenewal.toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });
  test("budgets alert each step once per month and refuse a second budget for the same scope", async () => {
    const now = new Date("2026-11-12T00:00:00Z");
    const spent = await ov.spentInScope("provider", "render", "2026-11-01", "2026-11-12");
    expect(spent).toBeGreaterThan(0); // the Nov 10 renewal above
    const b = await manual.createBudget({ name: "Render", scope: "provider", key: "render", inrMinor: Math.round(spent / 0.8), thresholds: "50,75,90,100" }, by);
    expect(await status(manual.createBudget({ name: "Render again", scope: "provider", key: "render", inrMinor: 100000 }, by))).toMatchObject({ status: 409 });
    expect(await status(manual.createBudget({ name: "No key", scope: "category", key: "", inrMinor: 100000 }, by))).toMatchObject({ status: 400 });
    const views = await ov.budgetViews(now);
    const v = views.find((x) => x.id === b.id)!;
    expect(v.pct).toBeGreaterThanOrEqual(79);
    expect(v.crossed).toEqual([50, 75]);
    const r1 = await manual.sweepCosts(now);
    expect(r1.alerts).toBe(2);
    expect((await manual.sweepCosts(now)).alerts).toBe(0);
    const keys = (await db.costAlert.findMany({ where: { key: { startsWith: `budget:${b.id}:2026-11:` } } })).map((a) => a.key).sort();
    expect(keys).toEqual([`budget:${b.id}:2026-11:50`, `budget:${b.id}:2026-11:75`]);
    const a = await manual.ackAlert((await db.costAlert.findFirstOrThrow({ where: { key: keys[0] } })).id, by);
    expect(a.status).toBe("acked");
    expect(a.ackedBy).toBe(by.login);
  });
});

describe("1314 overview and export", () => {
  test("an invoice for a provider-month supersedes that month's estimates in the totals, both stay in the ledger", async () => {
    const rows = [
      { day: "2026-08-02", provider: "vercel", source: "estimate", inrMinor: 100 },
      { day: "2026-08-20", provider: "vercel", source: "reported", inrMinor: 50 },
      { day: "2026-08-31", provider: "vercel", source: "billed", inrMinor: 900 },
      { day: "2026-09-02", provider: "vercel", source: "estimate", inrMinor: 70 },
      { day: "2026-08-10", provider: "gemini", source: "estimate", inrMinor: 40 },
    ];
    const r = ov.supersedeEstimates(rows);
    expect(r.supersededMinor).toBe(150);
    expect(r.kept.reduce((s, x) => s + x.inrMinor, 0)).toBe(900 + 70 + 40);
    await manual.createBill({ provider: "x", invoiceId: "X-AUG", category: "x", periodStart: "2026-08-01", periodEnd: "2026-08-31", amountMinor: 10000, currency: "USD" }, by);
    await ledger.recordCostEvent({ provider: "x", category: "x", feature: "x-post", amountMinor: 500, currency: "INR", source: "estimate", at: new Date("2026-08-05T00:00:00Z") });
    expect(await ov.spentInScope("provider", "x", "2026-08-01", "2026-08-31")).toBe((await db.billingRecord.findFirstOrThrow({ where: { invoiceId: "X-AUG" } })).inrMinor);
    const o = await ov.overview({ from: "2026-08-01", to: "2026-08-31", now: new Date("2026-09-01T00:00:00Z") });
    expect(o.supersededMinor).toBeGreaterThanOrEqual(500);
    expect(o.bySource.estimate).toBeGreaterThanOrEqual(500); // still shown by source
  });
  test("the overview sums the range, splits by provider/category/feature/source and knows when tracking started", async () => {
    const o = await ov.overview({ from: "2026-11-01", to: "2026-11-30", now: new Date("2026-11-12T00:00:00Z") });
    expect(o.trackingSince! <= "2026-01-15").toBe(true); // the yearly domain booked above, or anything earlier another test file metered
    expect(o.totalMinor).toBeGreaterThan(0);
    expect(o.byProvider.map((p) => p.key)).toEqual(expect.arrayContaining(["gemini", "render"]));
    expect(o.byFeature.find((f) => f.key === "captions")).toBeTruthy();
    expect(o.bySource.manual).toBeGreaterThan(0);
    expect(o.bySource.estimate).toBeGreaterThan(0);
    expect(o.bySource.forecast).toBe(0);
    expect(o.series.length).toBe(30);
    expect(o.series.reduce((s, p) => s + p.inrMinor, 0)).toBe(o.totalMinor);
    expect(o.month.key).toBe("2026-11");
    expect(o.month.forecast.projectedTotalMinor).toBeGreaterThanOrEqual(o.month.variableMtdMinor);
    expect(o.prices.filter((p) => p.current).length).toBeGreaterThan(5);
    expect(o.previousMinor).not.toBeNull(); // Oct is after tracking started
  });
  test("exports are CSV with one line per ledger row or per daily rollup", async () => {
    const d = await ov.exportRows("daily", "2026-11-01", "2026-11-30");
    expect(d.head[0]).toBe("day");
    expect(d.rows.length).toBeGreaterThan(0);
    const e = await ov.exportRows("events", "2026-11-03", "2026-11-03");
    const mine = e.rows.filter((r) => r[3] === "t1314");
    expect(mine.length).toBe(2);
    expect(mine[0][9]).toBe("USD");
  });
});

describe("1314 wiring", () => {
  const root = join(import.meta.dir, "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  test("admin area, nav entry and sweep slot exist; roles are super and finance", async () => {
    const { can } = await import("../lib/admin/perms");
    expect(can("super", "costs")).toBe(true);
    expect(can("finance", "costs")).toBe(true);
    expect(can("support", "costs")).toBe(false);
    expect(can("marketing", "costs")).toBe(false);
    expect(read("components/admin/AdminShell.tsx")).toContain('{ href: "/admin/costs", label: "Infrastructure & Costs", icon: Wallet, area: "costs", group: "Run" }');
    expect(read("app/api/cron/sweep/route.ts")).toContain('import("@/lib/costs/manual").then((m) => m.sweepCosts(now))');
  });
  test("the ledger hook in recordCost runs before the 1147 policy check", () => {
    const s = read("lib/subscriptions/costs.ts");
    expect(s.indexOf("await recordEconomicsUse(o);")).toBeGreaterThan(0);
    expect(s.indexOf("await recordEconomicsUse(o);")).toBeLessThan(s.indexOf("if (!(await getPolicy()).enabled) return null;"));
  });
  test("every sent Resend email is booked at the resend:email unit price", () => {
    const s = read("lib/email/index.ts");
    expect(s).toContain('l.recordUsage({ provider: "resend", sku: "resend:email", units: 1');
    expect(s.indexOf('status = "sent";')).toBeLessThan(s.indexOf('l.recordUsage({ provider: "resend"'));
  });
  test("schema has the six R1314 models in the template and the generated file", () => {
    for (const f of ["prisma/schema.template.prisma", "prisma/schema.prisma"]) {
      const s = read(f);
      for (const m of ["CostEvent", "CostDaily", "UnitPrice", "BillingRecord", "RecurringExpense", "CostBudget", "CostAlert"]) expect(s).toContain(`model ${m} {`);
    }
  });
  test("the admin page guards the costs area and the route handlers use it", () => {
    expect(read("app/admin/(panel)/costs/page.tsx")).toContain('requireAdmin("costs")');
    for (const f of ["app/api/admin/costs/route.ts", "app/api/admin/costs/[kind]/route.ts", "app/api/admin/costs/[kind]/[id]/route.ts", "app/api/admin/costs/export/route.ts"]) expect(read(f)).toContain('adminRoute');
    expect(read("app/api/admin/costs/export/route.ts")).toContain('"costs"');
  });
});
