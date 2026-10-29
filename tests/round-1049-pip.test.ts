import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseRange, previousRange } from "../lib/pip/range";
import { crc32, zip } from "../lib/pip/zip";
import { MAX_DOCS, readDocs, signDocs, LINK_TTL_MS } from "../lib/pip/links";
import { amountBounds, followUpPlan, keywordPlan, readPlan, wantsData } from "../lib/pip/plan";
import { numbersBacked, plainSummary } from "../lib/pip/run";
import { PIP_TOOLS } from "../lib/pip/types";

const NOW = new Date("2026-10-29T15:00:00Z"); // 20:30 in Kolkata
const TZ = "Asia/Kolkata";
const iso = (d: Date) => d.toISOString();
const read = (p: string) => readFileSync(p, "utf8");

describe("1049 date ranges in the person's timezone", () => {
  test("last month is the calendar month, Kolkata midnight to midnight", () => {
    const r = parseRange("my invoices from last month", TZ, NOW)!;
    // September 1 to October 1, both at 00:00 in Kolkata (UTC+5:30).
    expect(iso(r.from)).toBe("2026-08-31T18:30:00.000Z");
    expect(iso(r.to)).toBe("2026-09-30T18:30:00.000Z");
  });
  test("last month ends where this month starts", () => {
    const r = parseRange("last month", TZ, NOW)!;
    expect(parseRange("this month", TZ, NOW)!.from.getTime()).toBe(r.to.getTime());
    expect(r.to.getTime()).toBeGreaterThan(r.from.getTime());
    expect(r.label).toContain("Sept");
  });
  test("July to September covers three whole months", () => {
    const r = parseRange("payments from July to September", TZ, NOW)!;
    expect(iso(r.from)).toBe("2026-06-30T18:30:00.000Z");
    expect(iso(r.to)).toBe("2026-09-30T18:30:00.000Z");
  });
  test("nov to feb crosses the year and never runs into the future", () => {
    const r = parseRange("nov to feb", TZ, NOW)!;
    expect(r.to.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(r.from.getTime()).toBeLessThan(r.to.getTime());
  });
  test("last 30 days is rolling and capped at now", () => {
    const r = parseRange("last 30 days", TZ, NOW)!;
    expect(r.to.getTime()).toBe(NOW.getTime());
    expect(Math.round((r.to.getTime() - r.from.getTime()) / 864e5)).toBeGreaterThanOrEqual(29);
  });
  test("a year inside a document number is not a date", () => {
    expect(parseRange("show me invoice OUT-2026-000123", TZ, NOW)).toBeNull();
    expect(parseRange("credit note CN-2026-000001", TZ, NOW)).toBeNull();
    expect(parseRange("my invoices in 2025", TZ, NOW)!.label).toBe("2025 (1 Jan 2025 to 31 Dec 2025)");
  });
  test("a month inside a longer word is not a month", () => {
    expect(parseRange("summary-to-octopus", TZ, NOW)).toBeNull();
  });
  test("a bare 'may' is not a date", () => {
    expect(parseRange("may I see my posts", TZ, NOW)).toBeNull();
  });
  test("previousRange of a whole month is the month before", () => {
    const r = parseRange("in august", TZ, NOW)!;
    const p = previousRange(r, NOW);
    expect(iso(p.from)).toBe("2026-06-30T18:30:00.000Z");
    expect(iso(p.to)).toBe(iso(r.from));
  });
});

describe("1049 ZIP writer", () => {
  test("crc32 matches the reference value", () => {
    expect(crc32(new TextEncoder().encode("abc"))).toBe(0x352441c2);
  });
  test("local header, central directory and end record are present", () => {
    const z = zip([{ name: "a.txt", data: new TextEncoder().encode("abc") }, { name: "b.txt", data: new TextEncoder().encode("hello") }]);
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    const end = z.length - 22;
    expect(z.readUInt32LE(end)).toBe(0x06054b50);
    expect(z.readUInt16LE(end + 10)).toBe(2);
    expect(z.includes(Buffer.from("a.txt"))).toBe(true);
  });
});

describe("1049 download links", () => {
  test("round trip, tamper and expiry", () => {
    const href = signDocs("user_1", [{ kind: "inv", number: "OUT-2026-000001" }, { kind: "cn", number: "CN-2026-000001" }], 1_000);
    const t = new URL(href, "https://x.test").searchParams.get("t")!;
    expect(readDocs(t, 2_000)).toEqual({ userId: "user_1", docs: [{ kind: "inv", number: "OUT-2026-000001" }, { kind: "cn", number: "CN-2026-000001" }] });
    expect(readDocs(t, 1_000 + LINK_TTL_MS + 1)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "someone_else", d: ["inv:OUT-2026-000001"], e: 9e15 })).toString("base64url");
    expect(readDocs(`${forged}.${sig}`, 2_000)).toBeNull();
    expect(readDocs(`${body}.x${sig.slice(1)}`, 2_000)).toBeNull();
    const many = Array.from({ length: 300 }, (_, i) => ({ kind: "inv" as const, number: `OUT-2026-${String(i).padStart(6, "0")}` }));
    const big = new URL(signDocs("user_1", many, 1_000), "https://x.test").searchParams.get("t")!;
    expect(readDocs(big, 2_000)!.docs.length).toBe(MAX_DOCS);
    expect(big.length).toBeLessThan(4500);
  });
});

describe("1049 routing", () => {
  const tool = (m: string) => keywordPlan(m)?.tool ?? null;
  test("personal record requests go to the right lookup", () => {
    expect(tool("show my invoices from last month")).toBe("invoices");
    expect(tool("download my receipts")).toBe("invoices");
    expect(tool("which of my refunds don't have a credit note?")).toBe("refunds_missing_credit_note");
    expect(tool("my credit notes")).toBe("credit_notes");
    expect(tool("how much did I spend this year")).toBe("spending");
    expect(tool("show my failed payments")).toBe("payments");
    expect(tool("what are my trending posts this week")).toBe("top_posts");
    expect(tool("my engagement this month")).toBe("engagement");
    expect(tool("list my uploads")).toBe("uploads");
    expect(tool("my support tickets")).toBe("tickets");
    expect(tool("my unread notifications")).toBe("notices");
    expect(tool("summarise my activity")).toBe("activity");
    expect(tool("show my scheduled posts")).toBe("posts");
  });
  test("how-to questions and change requests stay with the help bot", () => {
    expect(tool("how do I download my invoice")).toBeNull();
    expect(tool("cancel my subscription")).toBeNull();
    expect(tool("I want a refund for my payment")).toBeNull();
    expect(tool("what is a credit note")).toBeNull();
    expect(wantsData("Invoices are emailed?")).toBe(false);
  });
  test("filters come out of the words", () => {
    expect(keywordPlan("show my failed payments")!.args.status).toBe("failed");
    expect(keywordPlan("my refunded invoices")!.args.status).toBe("refunded");
    expect(keywordPlan("my top 5 instagram posts")!.args).toMatchObject({ platform: "instagram", limit: 5, sort: "views" });
    expect(keywordPlan("compare my spending this month vs last month")!.args.compare).toBe(true);
    expect(amountBounds("invoices above ₹5,000")).toEqual({ minAmount: 5000 });
    expect(amountBounds("payments under $20")).toEqual({ maxAmount: 20 });
    expect(amountBounds("between 1k and 2.5k")).toEqual({ minAmount: 1000, maxAmount: 2500 });
  });
  test("follow-ups reuse the last card", () => {
    expect(followUpPlan("and in August?", { tool: "invoices", period: "last month" }, true)).toEqual({ tool: "invoices", args: { period: "and in August?", compare: false } });
    expect(followUpPlan("download them", { tool: "credit_notes", period: "this year" }, false)).toEqual({ tool: "credit_notes", args: { period: "this year" } });
    expect(followUpPlan("thanks", { tool: "invoices" }, false)).toBeNull();
    expect(followUpPlan("in august", null, true)).toBeNull();
  });
  test("a model plan is only accepted when it names a real tool", () => {
    expect(readPlan({ tool: "delete_account" })).toBeNull();
    expect(readPlan({ tool: null })).toBeNull();
    expect(readPlan({ tool: "payments", period: "last week", minAmount: 10 })!.args).toMatchObject({ period: "last week", minAmount: 10 });
    expect(PIP_TOOLS.length).toBe(13);
  });
});

describe("1049 summaries never invent numbers", () => {
  test("numbersBacked", () => {
    const facts = ["12 invoices found for Last month.", "Invoiced total ₹4,788.00."];
    expect(numbersBacked("You had 12 invoices last month, ₹4,788.00 in total.", facts)).toBe(true);
    expect(numbersBacked("You had 13 invoices.", facts)).toBe(false);
  });
  test("plainSummary falls back to the empty text", () => {
    expect(plainSummary({ rows: [], totals: [], facts: ["x"], empty: "No invoices in that period." } as never)).toBe("No invoices in that period.");
  });
});

describe("1049 wiring", () => {
  test("credit notes: owner-only download, issued on refund, in both schemas", () => {
    expect(read("app/api/billing/credit-notes/[number]/route.ts")).toContain("!user.actor");
    expect(read("lib/billing/service.ts")).toContain("issueCreditNote(");
    for (const f of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) {
      expect(read(f)).toContain("model CreditNote");
      expect(read(f)).toContain("model PipAccessLog");
    }
  });
  test("data tools only for a signed-in person; downloads need the same owner session", () => {
    const chat = read("app/api/support/chat/route.ts");
    expect(chat).toMatch(/if \(me && !b\.faqId\)/);
    const file = read("app/api/pip/file/route.ts");
    expect(file).toContain("user.actor");
    expect(file).toContain("user.id !== claims.userId");
    expect(file).toMatch(/userId: user\.id/);
    expect(file).toContain("private, no-store");
  });
  test("teammates are refused billing, records are logged, cards aren't stored", () => {
    expect(read("lib/pip/tools.ts")).toMatch(/ctx\.actorId && BILLING_TOOLS\.includes/);
    expect(read("lib/pip/run.ts")).toContain("pipAccessLog");
    expect(read("components/support/ChatWidget.tsx")).toContain("({ data: _d, ...m }) => m");
  });
});
