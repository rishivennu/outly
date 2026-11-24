/**
 * 1315: Infrastructure & Costs, Phase 2. Every model call books its tokens (provider-reported usage) at the unit
 * price on file, attributed to the feature and person that caused it; the 1147 per-request bridge stops booking AI
 * so nothing is counted twice. The dashboard gains the AI and People drilldowns and a CSV invoice import that
 * previews before it writes and never duplicates an invoice.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { usageOf } from "../lib/ai/llm-core";

let db: typeof import("../lib/db").db;
let ledger: typeof import("../lib/costs/ledger");
let tokens: typeof import("../lib/costs/tokens");
let ov: typeof import("../lib/costs/overview");
let imp: typeof import("../lib/costs/import");
let manual: typeof import("../lib/costs/manual");
let llm: typeof import("../lib/ai/llm");
const by = { login: "finance@outlly.test" };
const tag = `t1315-${Date.now().toString(36)}`;
const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8");

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  ledger = await import("../lib/costs/ledger");
  tokens = await import("../lib/costs/tokens");
  ov = await import("../lib/costs/overview");
  imp = await import("../lib/costs/import");
  manual = await import("../lib/costs/manual");
  llm = await import("../lib/ai/llm");
});
afterAll(async () => {
  await db.costEvent.deleteMany({ where: { feature: { startsWith: tag } } });
  await db.costDaily.deleteMany({ where: { feature: { startsWith: tag } } });
  await db.$disconnect();
});

describe("1315 token usage parsing", () => {
  test("Gemini usageMetadata: prompt, candidates and thoughts; OpenAI-shaped usage: prompt, completion, reasoning", () => {
    expect(usageOf("gemini", JSON.stringify({ usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 15 } }))).toEqual({ input: 120, output: 30, thoughts: 15 });
    expect(usageOf("gemini", JSON.stringify({ candidates: [] }))).toBeNull();
    expect(usageOf("kimi", JSON.stringify({ usage: { prompt_tokens: 50, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 8 } } }))).toEqual({ input: 50, output: 20, thoughts: 8 });
    expect(usageOf("nvidia", JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 2 } }))).toEqual({ input: 5, output: 2, thoughts: 0 });
    expect(usageOf("gemini", "not json")).toBeNull();
  });
  test("Gemini bills thinking tokens on top of the answer; OpenAI-shaped APIs already count reasoning inside completion_tokens", () => {
    expect(llm.billableOutput("gemini", { input: 1, output: 30, thoughts: 15 })).toBe(45);
    expect(llm.billableOutput("kimi", { input: 1, output: 20, thoughts: 8 })).toBe(20);
    expect(llm.billableOutput("nvidia", { input: 1, output: 20, thoughts: 0 })).toBe(20);
  });
  test("the call loop reads usage from every event, asks OpenAI-shaped APIs for a usage chunk, and books hedged losers too", () => {
    const src = read("lib/ai/llm.ts");
    expect(src.match(/stream_options: \{ include_usage: true \}/g)?.length).toBe(2);
    expect(src.match(/const u = usageOf\(m\.provider, e\);/g)?.length).toBe(2); // stream loop and the trailing buffer
    expect(src).toContain("meter?: { feature: string; userId?: string | null }");
    // Both the success path and the failure/cancel path book: a cancelled hedge model still consumed its prompt.
    expect(src.match(/book\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("billableOutput(m.provider, u)");
  });
});

describe("1315 ledger", () => {
  test("priced tokens book input and output rows in fractional paise with the unit price pinned; the daily rollup keeps the fraction", async () => {
    const at = new Date("2026-11-05T09:00:00Z");
    const rows = await tokens.recordTokens({ provider: "gemini", model: "gemini-2.5-flash", input: 1000, output: 400, feature: `${tag}-writing`, userId: "u-1315-a", at });
    expect(rows.length).toBe(2);
    const [inRow, outRow] = rows as NonNullable<(typeof rows)[number]>[];
    expect(inRow.unit).toBe("token-in");
    expect(outRow.unit).toBe("token-out");
    expect(inRow.category).toBe("ai");
    expect(inRow.source).toBe("reported");
    expect(inRow.model).toBe("gemini-2.5-flash");
    expect(inRow.unitPriceId).toBeTruthy();
    // $0.30/M input: 1000 tokens = $0.0003 = 0.03 cents; stored as USD minor with the fraction kept.
    expect(inRow.amountMinor).toBeCloseTo(0.03, 9);
    expect(outRow.amountMinor).toBeCloseTo(0.1, 9); // $2.50/M output: 400 tokens
    expect(inRow.inrMinor).toBeGreaterThan(0);
    expect(inRow.inrMinor).toBeLessThan(100);
    const daily = await db.costDaily.findMany({ where: { feature: `${tag}-writing`, day: "2026-11-05" } });
    expect(daily.length).toBe(1);
    expect(daily[0].units).toBe(1400);
    expect(daily[0].inrMinor).toBeCloseTo(inRow.inrMinor + outRow.inrMinor, 6);
  });
  test("a model with no price is still counted, booked at zero, and asks for a price once", async () => {
    const at = new Date("2026-11-05T09:30:00Z");
    const model = `mystery-${tag}`;
    const r1 = await tokens.recordTokens({ provider: "nvidia", model: `nvidia/${model}`, input: 10, output: 5, feature: `${tag}-assist`, at });
    const r2 = await tokens.recordTokens({ provider: "nvidia", model: `nvidia/${model}`, input: 10, output: 5, feature: `${tag}-assist`, at });
    expect(r1.length + r2.length).toBe(4);
    for (const r of [...r1, ...r2]) { expect(r!.amountMinor).toBe(0); expect(r!.inrMinor).toBe(0); expect(r!.unitPriceId).toBeNull(); expect(JSON.parse(r!.meta).unpriced).toBe(true); expect(r!.model).toBe(model); }
    const alerts = await db.costAlert.findMany({ where: { key: `price-missing:nvidia:${model}` } });
    expect(alerts.length).toBe(1);
    expect(alerts[0].severity).toBe("info");
    await db.costAlert.deleteMany({ where: { key: `price-missing:nvidia:${model}` } });
  });
  test("Kimi goes to the OpenRouter provider under its bare model id; NVIDIA dev-tier models have a zero price on file", async () => {
    expect(tokens.LEDGER_PROVIDER.kimi).toBe("openrouter");
    expect(tokens.skuModel("moonshotai/Kimi-K2.6")).toBe("kimi-k2.6");
    const p = await (await import("../lib/costs/prices")).priceFor("nvidia", "nemotron-3.5-super-vl-120b-a12b:output");
    expect(p?.price).toBe(0);
  });
  test("the 1147 per-request bridge no longer books text AI (tokens do), but still books transcription minutes", async () => {
    const uid = `u-${tag}`;
    expect(await ledger.recordEconomicsUse({ userId: uid, category: "ai", units: 1, now: new Date("2026-11-06T00:00:00Z") })).toBeNull();
    expect(await ledger.recordEconomicsUse({ userId: uid, category: "ai_reply", units: 1 })).toBeNull();
    expect(await ledger.recordEconomicsUse({ userId: uid, category: "ai_assist", units: 1 })).toBeNull();
    const t = await ledger.recordEconomicsUse({ userId: uid, category: "transcription", units: 2.5, now: new Date("2026-11-06T00:00:00Z") });
    expect(t?.category).toBe("transcription");
    expect(t?.units).toBe(2.5);
    await db.costEvent.deleteMany({ where: { userId: uid } });
    await db.costDaily.updateMany({ where: { day: "2026-11-06", category: "transcription" }, data: {} });
  });
});

describe("1315 drilldowns", () => {
  const day = "2026-10-14";
  const at = new Date(`${day}T12:00:00Z`);
  let userA = "", userB = "";
  beforeAll(async () => {
    const a = await db.user.create({ data: { name: `Asha ${tag}`, email: `asha-${tag}@outlly.test`, passwordHash: "x" } });
    const b = await db.user.create({ data: { name: `Bo ${tag}`, email: `bo-${tag}@outlly.test`, passwordHash: "x" } });
    userA = a.id; userB = b.id;
    const plan = await db.plan.upsert({ where: { slug: `plan-${tag}` }, create: { slug: `plan-${tag}`, name: "Creator", priceMinor: 49900 }, update: {} });
    await db.subscription.create({ data: { userId: userA, planId: plan.id, status: "active", priceMinor: 49900, currency: "INR", interval: "month", provider: "razorpay", priceTier: "standard", currentPeriodEnd: new Date("2099-01-01T00:00:00Z") } });
    await tokens.recordTokens({ provider: "gemini", model: "gemini-2.5-flash", input: 10_000, output: 2_000, feature: `${tag}-writing`, userId: userA, at });
    await tokens.recordTokens({ provider: "gemini", model: "gemini-2.5-flash", input: 5_000, output: 1_000, feature: `${tag}-captions`, userId: userA, at });
    await tokens.recordTokens({ provider: "gemini", model: "gemini-2.5-pro", input: 1_000, output: 500, feature: `${tag}-writing`, userId: userB, at });
    await tokens.recordTokens({ provider: "nvidia", model: "nvidia/nemotron-3.5-lightning-30b-a3b", input: 800, output: 0, feature: `${tag}-writing`, userId: userB, at }); // cancelled hedge: prompt only
    await ledger.recordCostEvent({ provider: "vercel", category: "hosting", feature: `${tag}-platform`, amountMinor: 2000, currency: "USD", source: "billed", at });
  });
  afterAll(async () => {
    await db.subscription.deleteMany({ where: { userId: { in: [userA, userB] } } });
    await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await db.plan.deleteMany({ where: { slug: `plan-${tag}` } });
  });
  test("AI view: by model and by feature, calls = prompt rows, tokens in/out, cost per 1k calls, unpriced flagged", async () => {
    const ai = await ov.aiBreakdown({ from: day, to: day });
    const mine = ai.byModel.filter((m) => ai.byFeature.some((f) => f.key.startsWith(tag)));
    expect(mine.length).toBeGreaterThan(0);
    const flash = ai.byModel.find((m) => m.key === "gemini/gemini-2.5-flash")!;
    expect(flash.calls).toBe(2);
    expect(flash.tokensIn).toBe(15_000);
    expect(flash.tokensOut).toBe(3_000);
    expect(flash.inrMinor).toBeGreaterThan(0);
    expect(flash.perThousandCallsMinor).toBe(Math.round((flash.inrMinor / 2) * 1000));
    expect(flash.unpriced).toBe(false);
    const nem = ai.byModel.find((m) => m.key === "nvidia/nemotron-3.5-lightning-30b-a3b")!;
    expect(nem.calls).toBe(1);
    expect(nem.tokensOut).toBe(0);
    expect(nem.unpriced).toBe(false); // zero price on file is a price
    const writing = ai.byFeature.find((f) => f.key === `${tag}-writing`)!;
    expect(writing.calls).toBe(3);
    expect(writing.tokensIn).toBe(11_800);
    expect(ai.byFeature.find((f) => f.key === `${tag}-platform`)).toBeUndefined(); // hosting is not AI
    expect(ai.calls).toBeGreaterThanOrEqual(4);
    expect(ai.byDay.find((d) => d.day === day)?.tokens).toBeGreaterThanOrEqual(20_300);
    expect(ai.byModel[0].inrMinor).toBeGreaterThanOrEqual(ai.byModel[ai.byModel.length - 1].inrMinor);
  });
  test("People view: top users with name, email, today's plan and a per-feature split; platform rows kept apart", async () => {
    const p = await ov.topUsers({ from: day, to: day, limit: 50 });
    const a = p.users.find((u) => u.userId === userA)!;
    const b = p.users.find((u) => u.userId === userB)!;
    expect(a.name).toBe(`Asha ${tag}`);
    expect(a.email).toBe(`asha-${tag}@outlly.test`);
    expect(a.tier).toBe(`plan-${tag} · standard`);
    expect(b.tier).toBe("free");
    expect(a.inrMinor).toBeGreaterThan(b.inrMinor);
    expect(p.users.indexOf(a)).toBeLessThan(p.users.indexOf(b));
    expect(a.features.map((f) => f.key).sort()).toEqual([`${tag}-captions`, `${tag}-writing`]);
    expect(a.features[0].inrMinor).toBeGreaterThanOrEqual(a.features[1].inrMinor);
    expect(a.count).toBe(4);
    expect(b.count).toBe(3); // pro in+out, nemotron in only
    expect(p.attributedMinor).toBeGreaterThanOrEqual(a.inrMinor + b.inrMinor);
    expect(p.platformMinor).toBeGreaterThan(0);
    expect(p.distinctUsers).toBeGreaterThanOrEqual(2);
    expect(a.pct + b.pct).toBeLessThanOrEqual(100);
  });
  test("a deleted account keeps its rows and is labelled", async () => {
    await tokens.recordTokens({ provider: "gemini", model: "gemini-2.5-flash", input: 100, output: 10, feature: `${tag}-gone`, userId: `gone-${tag}`, at: new Date("2026-10-15T00:00:00Z") });
    const p = await ov.topUsers({ from: "2026-10-15", to: "2026-10-15" });
    const g = p.users.find((u) => u.userId === `gone-${tag}`)!;
    expect(g.name).toBe("Deleted account");
    expect(g.tier).toBe("");
  });
  test("the GET API serves the drilldowns behind ?view=", () => {
    const src = read("app/api/admin/costs/route.ts");
    expect(src).toContain('view === "ai"');
    expect(src).toContain('view === "users"');
  });
});

describe("1315 CSV invoice import", () => {
  const csv = (rows: string[]) => ["provider,invoiceId,periodStart,periodEnd,amount,currency,status,note", ...rows].join("\r\n");
  test("parses quoted fields, header aliases and amounts in major units; bad lines come back as errors, not throws", () => {
    const r = imp.parseBills(["Provider,Invoice No,Start,End,Total,Currency,Status,Notes", `vercel,V-${tag}-1,2026-10-01,2026-10-31,"1,234.50",USD,paid,"Pro, two seats"`, `nope,X-1,2026-10-01,2026-10-31,10,USD,paid,`, `vercel,V-${tag}-2,2026-10-31,2026-10-01,10,USD,paid,`, `vercel,V-${tag}-3,2026-10-01,2026-10-31,abc,USD,paid,`, `render,R-${tag}-1,2026-10-01,2026-10-31,7,USD,due,`, `render,R-${tag}-1,2026-10-01,2026-10-31,7,USD,due,again`].join("\n"));
    expect(r.columns.slice(0, 5)).toEqual(["provider", "invoiceId", "periodStart", "periodEnd", "amount"]);
    expect(r.rows.map((x) => x.status)).toEqual(["ok", "error", "error", "error", "ok", "duplicate"]);
    expect(r.rows[0].bill).toMatchObject({ provider: "vercel", invoiceId: `V-${tag}-1`, amountMinor: 123450, currency: "USD", status: "paid", note: "Pro, two seats" });
    expect(r.rows[1].reason).toContain("Unknown provider");
    expect(r.rows[2].reason).toContain("end must be after");
    expect(r.rows[3].reason).toContain("not a number");
    expect(r.rows[5].reason).toContain("Repeated in this file");
    expect(() => imp.parseBills("")).toThrow();
    expect(() => imp.parseBills("provider,amount\nvercel,1")).toThrow(/Missing column/);
  });
  test("preview marks invoices already on file, commit books the ok lines once, and a second commit books nothing", async () => {
    await manual.createBill({ provider: "supabase", invoiceId: `S-${tag}-old`, periodStart: "2026-09-01", periodEnd: "2026-09-30", amountMinor: 2500, currency: "USD" }, by);
    const text = csv([`supabase,S-${tag}-old,2026-09-01,2026-09-30,25.00,USD,paid,`, `supabase,S-${tag}-new,2026-10-01,2026-10-31,25.00,USD,paid,October`, `resend,RS-${tag},2026-10-01,2026-10-31,20,USD,paid,`]);
    const preview = await imp.importBills({ csv: text }, by);
    expect(preview.committed).toBe(0);
    expect(preview.rows.map((r) => r.status)).toEqual(["duplicate", "ok", "ok"]);
    expect(preview.rows[0].reason).toBe("Already recorded.");
    expect(await db.billingRecord.count({ where: { invoiceId: `S-${tag}-new` } })).toBe(0);
    const commit = await imp.importBills({ csv: text, commit: true }, by);
    expect(commit.committed).toBe(2);
    const bill = await db.billingRecord.findFirstOrThrow({ where: { invoiceId: `S-${tag}-new` } });
    expect(bill.amountMinor).toBe(2500);
    expect(bill.note).toBe("October");
    expect(await db.costEvent.count({ where: { ref: `bill:${bill.id}` } })).toBe(1);
    const again = await imp.importBills({ csv: text, commit: true }, by);
    expect(again.committed).toBe(0);
    expect(again.rows.every((r) => r.status === "duplicate")).toBe(true);
    const ids = (await db.billingRecord.findMany({ where: { invoiceId: { contains: tag } }, select: { id: true } })).map((b) => b.id);
    await db.costEvent.deleteMany({ where: { ref: { in: ids.map((id) => `bill:${id}`) } } });
    await db.billingRecord.deleteMany({ where: { invoiceId: { contains: tag } } });
  });
  test("the route and the panel expose it", () => {
    expect(read("app/api/admin/costs/[kind]/route.ts")).toContain('params.kind === "import"');
    const panel = read("components/admin/costs/CostsPanel.tsx");
    expect(panel).toContain("export function ImportBillsCard");
    expect(panel).toContain('"/api/admin/costs/import"');
    expect(read("app/admin/(panel)/costs/page.tsx")).toContain("<ImportBillsCard />");
  });
});

describe("1315 wiring", () => {
  test("every AI call path tags its feature and, where there is one, the person", () => {
    const pins: [string, string][] = [
      ["app/api/ai/hooks/route.ts", 'meter: { feature: "writing", userId: uid }'],
      ["app/api/ai/platform/route.ts", 'meter: { feature: "writing", userId: uid }'],
      ["app/api/ai/highlights/route.ts", 'meter: { feature: "assist", userId: uid }'],
      ["app/api/ai/video-caption/route.ts", 'feature: "captions"'],
      ["app/api/ai/photo-caption/route.ts", 'feature: "captions"'],
      ["app/api/ai/replies/route.ts", 'feature: "inbox-reply"'],
      ["lib/support/bot.ts", 'meter: { feature: "support-chat", userId: ctx.userId ?? null }'],
      ["app/api/support/chat/route.ts", "userId: me?.id ?? null"],
      ["lib/blog/llm.ts", 'meter: { feature: "blog" }'],
      ["lib/try.ts", 'meter: { feature: "try" }'],
    ];
    for (const [file, needle] of pins) expect(read(file), file).toContain(needle);
  });
  test("the page has the three views and the AI/People tabs share the date range", () => {
    const page = read("app/admin/(panel)/costs/page.tsx");
    expect(page).toContain('{ value: "ai", label: "AI usage" }');
    expect(page).toContain('{ value: "users", label: "People" }');
    expect(page).toContain('<FilterChips param="view"');
    expect(page).toContain("aiBreakdown({ from: o.range.from, to: o.range.to })");
    const { FEATURE_LABEL, PROVIDERS } = require("../lib/costs/core");
    expect(FEATURE_LABEL.try).toBeTruthy();
    expect(PROVIDERS.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["nvidia", "openrouter", "groq"]));
  });
  test("the ledger keeps fractional minor units (Float) for token rows", () => {
    const schema = read("prisma/schema.template.prisma");
    expect(schema).toMatch(/model CostEvent \{[\s\S]*?amountMinor Float[\s\S]*?inrMinor\s+Float/);
    expect(schema).toMatch(/model CostDaily \{[\s\S]*?inrMinor\s+Float/);
  });
});
