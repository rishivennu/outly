/**
 * 1333: Infrastructure & Costs, Phase 6. The Excel export is a real xlsx (a stored zip of the standard parts, inline
 * strings, numbers as numbers, a frozen header row) with Summary, Daily and Ledger sheets; the PDF report prints
 * KPIs, breakdowns, budgets, recommendations and open alerts in a WinAnsi-safe way; the route serves both.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { crc32, sheetName, sheetXml, workbookParts, xlsx, zipEntries, zipRead, zipStored } from "../lib/costs/xlsx";
import { dailySheet, inr, ledgerSheet, pdfInr, pdfSafe, reportSections, summarySheet, wrapText } from "../lib/costs/report-core";
import type { Overview } from "../lib/costs/overview";

let db: typeof import("../lib/db").db;
let report: typeof import("../lib/costs/report");
const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8");
const txt = (b: Uint8Array | null) => new TextDecoder().decode(b ?? new Uint8Array());

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  report = await import("../lib/costs/report");
});
afterAll(async () => {
  await db.$disconnect();
});

describe("1333 zip + xlsx (pure)", () => {
  test("crc32 matches the reference values", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  test("a stored zip lists its entries and gives the bytes back unchanged", () => {
    const z = zipStored({ "a.txt": "hello", "dir/b.xml": "<x/>" }, new Date("2026-03-10T12:34:56Z"));
    expect(Array.from(z.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(zipEntries(z).map((e) => e.name)).toEqual(["a.txt", "dir/b.xml"]);
    expect(txt(zipRead(z, "a.txt"))).toBe("hello");
    expect(txt(zipRead(z, "dir/b.xml"))).toBe("<x/>");
    expect(zipRead(z, "nope")).toBeNull();
    expect(zipEntries(z)[0].crc).toBe(crc32(new TextEncoder().encode("hello")));
  });

  test("sheet xml: inline strings, numbers as numbers, header styled and frozen, blanks skipped, xml escaped", () => {
    const x = sheetXml({ name: "S", head: ["a", "b"], rows: [["x<y", 12.5], [null, "ok"], ["", 0]], widths: [10, 20] });
    expect(x).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">a</t></is></c>');
    expect(x).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">x&lt;y</t></is></c>');
    expect(x).toContain('<c r="B2"><v>12.5</v></c>');
    expect(x).toContain('<row r="3"><c r="B3" t="inlineStr"><is><t xml:space="preserve">ok</t></is></c></row>');
    expect(x).toContain('<row r="4"><c r="B4"><v>0</v></c></row>');
    expect(x).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(x).toContain('<col min="2" max="2" width="20" customWidth="1"/>');
    expect(x).toContain('<dimension ref="A1:B4"/>');
  });

  test("column letters go past Z", () => {
    const x = sheetXml({ name: "W", head: Array.from({ length: 28 }, (_, i) => `h${i}`), rows: [] });
    expect(x).toContain('<c r="AA1"');
    expect(x).toContain('<c r="AB1"');
    expect(x).toContain('<dimension ref="A1:AB1"/>');
  });

  test("sheet names are legal and unique", () => {
    expect(sheetName("Costs: 2026/03 [draft]?*")).toBe("Costs  2026 03  draft");
    expect(sheetName("x".repeat(40))).toHaveLength(31);
    expect(sheetName("   ")).toBe("Sheet");
    const parts = workbookParts([{ name: "Same", head: [], rows: [] }, { name: "Same", head: [], rows: [] }], { title: "t", created: new Date("2026-03-10T00:00:00Z") });
    expect(parts["xl/workbook.xml"]).toContain('<sheet name="Same" sheetId="1" r:id="rId1"/><sheet name="Same 2" sheetId="2" r:id="rId2"/>');
  });

  test("the workbook has every part an xlsx needs and they agree with each other", () => {
    const b = xlsx([{ name: "One", head: ["k", "v"], rows: [["a", 1]] }, { name: "Two", head: ["z"], rows: [] }], { title: "Outlly costs", created: new Date("2026-03-10T00:00:00Z") });
    const names = zipEntries(b).map((e) => e.name);
    expect(names).toEqual(["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
    const ct = txt(zipRead(b, "[Content_Types].xml"));
    expect(ct).toContain('PartName="/xl/worksheets/sheet2.xml"');
    expect(ct).toContain("spreadsheetml.sheet.main+xml");
    expect(txt(zipRead(b, "xl/_rels/workbook.xml.rels"))).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"');
    expect(txt(zipRead(b, "docProps/core.xml"))).toContain("<dc:title>Outlly costs</dc:title>");
    expect(txt(zipRead(b, "xl/worksheets/sheet1.xml"))).toContain('<c r="B2"><v>1</v></c>');
  });
});

const fakeOverview = (): Overview => ({
  range: { from: "2026-03-01", to: "2026-03-10" },
  trackingSince: "2026-01-04",
  totalMinor: 123456,
  previousMinor: 100000,
  bySource: { billed: 50000, reported: 40000, estimate: 33456, manual: 0, forecast: 0 },
  supersededMinor: 1200,
  byProvider: [{ key: "gemini", label: "Google Gemini", inrMinor: 100000, units: 5, count: 7, pct: 81 }, { key: "x", label: "X API", inrMinor: 23456, units: 2, count: 3, pct: 19 }],
  byCategory: [{ key: "ai", label: "AI (text)", inrMinor: 123456, units: 7, count: 10, pct: 100 }],
  byFeature: [{ key: "writing", label: "AI writing", inrMinor: 123456, units: 7, count: 10, pct: 100 }],
  series: [],
  month: { key: "2026-03", variableMtdMinor: 90000, recurringMonthlyMinor: 170000, recurringBookedMinor: 170000, forecast: { projectedTotalMinor: 440000, projectedVariableMinor: 270000, confidence: "medium", dailyRateMinor: 9000 } as never, dayOfMonth: 10, daysInMonth: 31 },
  recurring: [],
  bills: [],
  budgets: [{ id: "b1", name: "Everything", scope: "total", key: "", inrMinor: 400000, thresholds: "50,75,90,100", active: true, spentMinor: 260000, pct: 65, crossed: [50] }],
  alerts: [{ id: "a1", key: "k", kind: "spike", severity: "warn", title: "X API spent ₹234 on 2026-03-09", body: "That is 3.0x its usual day.", href: "/admin/costs", status: "open", createdAt: "2026-03-10T05:00:00.000Z", ackedAt: null, ackedBy: null }, { id: "a2", key: "k2", kind: "budget", severity: "info", title: "old", body: "", href: "", status: "acked", createdAt: "2026-02-01T00:00:00.000Z", ackedAt: null, ackedBy: null }],
  prices: [],
  connections: [],
});

describe("1333 report content (pure)", () => {
  test("the summary sheet carries the KPIs, every breakdown, budgets, recommendations and open alerts as numbers", () => {
    const sh = summarySheet(fakeOverview(), [{ id: "r", severity: "warn", title: "Everything is on course", body: "Slow down.", href: "/admin/costs", saveMinor: 5000 }]);
    expect(sh.name).toBe("Summary");
    expect(sh.rows).toContainEqual(["Spend in range (INR)", 1234.56]);
    expect(sh.rows).toContainEqual(["Month-end forecast (INR)", 4400, "medium confidence"]);
    expect(sh.rows).toContainEqual(["Google Gemini", 1000, 81, 5, 7]);
    expect(sh.rows).toContainEqual(["Provider-reported", 400]);
    expect(sh.rows).toContainEqual(["Everything", 4000, 2600, 65, "yes"]);
    expect(sh.rows).toContainEqual(["Everything is on course", "warn", 50, "Slow down."]);
    expect(sh.rows).toContainEqual(["X API spent ₹234 on 2026-03-09", "warn", "2026-03-10", "That is 3.0x its usual day."]);
    expect(sh.rows.some((r) => r[0] === "old")).toBe(false); // acked alerts stay out
    expect(inr(123456)).toBe(1234.56);
  });

  test("daily and ledger sheets turn the CSV's money and unit strings back into numbers", () => {
    const d = dailySheet(["day", "provider", "units", "count", "inr"], [["2026-03-01", "gemini", "3", 2, "12.34"]]);
    expect(d.rows[0]).toEqual(["2026-03-01", "gemini", 3, 2, 12.34]);
    const l = ledgerSheet(["at", "amount", "currency", "fxToInr", "inr", "ref"], [["2026-03-01T00:00:00.000Z", "0.50", "USD", 84.1, "42.05", ""]]);
    expect(l.rows[0]).toEqual(["2026-03-01T00:00:00.000Z", 0.5, "USD", 84.1, 42.05, ""]);
    expect(l.name).toBe("Ledger");
  });

  test("pdf text is WinAnsi-safe: rupee becomes Rs, arrows and dashes are plain, anything else is a question mark", () => {
    expect(pdfSafe("₹1,234 → done — “ok” … 2×")).toBe("Rs 1,234 -> done - \"ok\" ... 2x");
    expect(pdfSafe("café")).toBe("café");
    expect(pdfSafe("नमस्ते")).toBe("??????");
    expect(pdfInr(123456)).toBe("Rs 1,235");
  });

  test("wrapText wraps on words, splits words longer than the line and keeps paragraphs", () => {
    const m = (s: string) => s.length * 10;
    expect(wrapText("one two three four", 90, m)).toEqual(["one two", "three", "four"]);
    expect(wrapText("abcdefghijkl", 50, m)).toEqual(["abcde", "fghij", "kl"]);
    expect(wrapText("a\nb", 100, m)).toEqual(["a", "b"]);
    expect(wrapText("", 100, m)).toEqual([""]);
  });

  test("the report sections cover KPIs, four breakdowns, budgets, recommendations and only open alerts", () => {
    const r = reportSections(fakeOverview(), [{ id: "r", severity: "info", title: "Two hosts", body: "Cancel one.", href: "/admin/costs", saveMinor: 60000 }], new Date("2026-03-10T09:30:00Z"));
    expect(r.title).toBe("Infrastructure & Costs");
    expect(r.subtitle).toBe("2026-03-01 to 2026-03-10, tracking since 2026-01-04");
    expect(r.kpis).toEqual([["Spend in range", "Rs 1,235"], ["Previous period", "Rs 1,000"], ["This month so far", "Rs 2,600"], ["Month-end forecast", "Rs 4,400 (medium)"], ["Recurring commitments", "Rs 1,700/mo"]]);
    expect(r.tables.map((t) => t.title)).toEqual(["By provider", "By category", "By feature", "Where the numbers come from", "Budgets", "Recommendations", "Open alerts"]);
    expect(r.tables[0].rows[0]).toEqual(["Google Gemini", "Rs 1,000", "81%", "7"]);
    expect(r.tables[4].rows[0]).toEqual(["Everything", "everything", "Rs 4,000", "Rs 2,600", "65%"]);
    expect(r.tables[5].rows[0]).toEqual(["Consider", "Two hosts. Cancel one. (about Rs 600)"]);
    expect(r.tables[6].rows).toEqual([["2026-03-10", "warn", "X API spent Rs 234 on 2026-03-09. That is 3.0x its usual day."]]);
    expect(r.footer).toContain("Generated 2026-03-10 09:30 UTC by Outlly");
    for (const t of r.tables) expect(Math.abs(t.widths.reduce((s, w) => s + w, 0) - 1)).toBeLessThan(1e-9);
  });
});

describe("1333 real exports", () => {
  test("the workbook builds from the live ledger with three sheets", async () => {
    const { bytes, range } = await report.costsWorkbook("2026-03-01", "2026-03-10", new Date("2026-03-11T00:00:00Z"));
    expect(range).toEqual({ from: "2026-03-01", to: "2026-03-10" });
    const names = zipEntries(bytes).map((e) => e.name);
    expect(names).toContain("xl/worksheets/sheet3.xml");
    expect(txt(zipRead(bytes, "xl/workbook.xml"))).toContain('<sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Daily" sheetId="2" r:id="rId2"/><sheet name="Ledger" sheetId="3" r:id="rId3"/>');
    expect(txt(zipRead(bytes, "xl/worksheets/sheet1.xml"))).toContain("2026-03-01 to 2026-03-10");
  });

  test("the pdf builds, has at least one page and the right metadata", async () => {
    const { bytes, pages, range } = await report.costsPdf("2026-03-01", "2026-03-10", new Date("2026-03-11T00:00:00Z"));
    expect(txt(bytes.slice(0, 5))).toBe("%PDF-");
    expect(pages).toBeGreaterThanOrEqual(1);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(pages);
    expect(doc.getTitle()).toBe(`Outlly costs ${range.from} to ${range.to}`);
    expect(doc.getAuthor()).toBe("Outlly");
  });

  test("parseRange defaults to the last 30 days and refuses junk", () => {
    const r = report.parseRange(new URLSearchParams("from=2026-03-01&to=2026-03-10"));
    expect(r).toEqual({ from: "2026-03-01", to: "2026-03-10" });
    const d = report.parseRange(new URLSearchParams("from=junk&to=2026-03-30"));
    expect(d).toEqual({ from: "2026-03-01", to: "2026-03-30" });
    expect(report.exportName("report", "2026-03-01", "2026-03-30", "pdf")).toBe("outlly-costs-report-2026-03-01-to-2026-03-30.pdf");
  });
});

describe("1333 wiring (source)", () => {
  test("the export route serves csv, xlsx and pdf with the right types and names", () => {
    const s = read("app/api/admin/costs/export/route.ts");
    expect(s).toContain('import { costsPdf, costsWorkbook, exportName, parseRange } from "@/lib/costs/report";');
    expect(s).toContain('const format = sp.get("format") === "xlsx" ? "xlsx" : sp.get("format") === "pdf" ? "pdf" : "csv";');
    expect(s).toContain('headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", exportName("workbook", range.from, range.to, "xlsx"))');
    expect(s).toContain('headers("application/pdf", exportName("report", range.from, range.to, "pdf"))');
    expect(s).toContain('headers("text/csv; charset=utf-8", exportName(kind, from, to, "csv"))');
    expect(s).toContain('"cache-control": "no-store"');
    expect(s).toContain("}, [20, 60_000]);");
  });

  test("the dashboard offers the PDF report and the Excel workbook next to the CSVs", () => {
    const s = read("app/admin/(panel)/costs/page.tsx");
    expect(s).toContain("href={`/api/admin/costs/export?format=pdf&${exportQs}`}>PDF report</a>");
    expect(s).toContain("href={`/api/admin/costs/export?format=xlsx&${exportQs}`}>Excel workbook</a>");
    expect(s).toContain("href={`/api/admin/costs/export?kind=daily&${exportQs}`}>Daily CSV</a>");
    expect(s).toContain("href={`/api/admin/costs/export?kind=events&${exportQs}`}>Ledger CSV</a>");
  });

  test("no new dependency: the xlsx writer uses only the platform", () => {
    const s = read("lib/costs/xlsx.ts");
    expect(s).not.toMatch(/^import /m);
    expect(read("package.json")).not.toMatch(/exceljs|"xlsx"|jszip|fflate/);
  });
});
