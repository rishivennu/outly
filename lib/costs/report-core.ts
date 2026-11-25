import { CATEGORY_LABEL, SOURCE_LABEL, fmtInr, type CostCategoryId, type CostSource } from "./core";
import type { Recommendation } from "./insights-core";
import type { Overview } from "./overview";
import type { Sheet } from "./xlsx";

/** R1333 Costs Phase 6, the pure half: the summary sheet rows and the text the PDF prints, from an overview. */
export const inr = (minor: number) => Math.round(minor) / 100;

export function summarySheet(o: Overview, recs: Recommendation[]): Sheet {
  const rows: (string | number | null)[][] = [];
  const line = (...r: (string | number | null)[]) => rows.push(r);
  line("Range", `${o.range.from} to ${o.range.to}`);
  line("Tracking since", o.trackingSince ?? "");
  line("Spend in range (INR)", inr(o.totalMinor));
  line("Previous period (INR)", o.previousMinor == null ? "" : inr(o.previousMinor));
  line("This month so far (INR)", inr(o.month.variableMtdMinor + o.month.recurringBookedMinor));
  line("Month-end forecast (INR)", inr(o.month.forecast.projectedTotalMinor), `${o.month.forecast.confidence} confidence`);
  line("Recurring commitments (INR/month)", inr(o.month.recurringMonthlyMinor));
  line("Estimates set aside for invoices (INR)", inr(o.supersededMinor));
  line();
  line("By provider", "INR", "Share %", "Units", "Events");
  for (const s of o.byProvider) line(s.label, inr(s.inrMinor), s.pct, s.units, s.count);
  line();
  line("By category", "INR", "Share %", "Units", "Events");
  for (const s of o.byCategory) line(s.label, inr(s.inrMinor), s.pct, s.units, s.count);
  line();
  line("By feature", "INR", "Share %", "Units", "Events");
  for (const s of o.byFeature) line(s.label, inr(s.inrMinor), s.pct, s.units, s.count);
  line();
  line("By source", "INR");
  for (const k of Object.keys(o.bySource) as CostSource[]) if (k !== "forecast") line(SOURCE_LABEL[k], inr(o.bySource[k]));
  line();
  line("Budgets", "Budget INR", "Spent INR", "Used %", "Active");
  for (const b of o.budgets) line(b.name, inr(b.inrMinor), inr(b.spentMinor), b.pct, b.active ? "yes" : "no");
  line();
  line("Recommendations", "Severity", "Could save INR", "Detail");
  for (const r of recs) line(r.title, r.severity, r.saveMinor == null ? "" : inr(r.saveMinor), r.body);
  line();
  line("Open alerts", "Severity", "Raised", "Detail");
  for (const a of o.alerts.filter((a) => a.status === "open")) line(a.title, a.severity, a.createdAt.slice(0, 10), a.body);
  return { name: "Summary", head: ["Infrastructure & Costs", "", "", "", ""], rows, widths: [44, 16, 14, 12, 60] };
}

export function dailySheet(head: string[], rows: (string | number | null | undefined)[][]): Sheet {
  // the CSV keeps money as text ("12.34"); the sheet gets real numbers in the money/units columns
  const numeric = new Set(["units", "count", "inr", "amount", "fxToInr"]);
  const idx = head.map((h) => numeric.has(h));
  return { name: "Daily", head, rows: rows.map((r) => r.map((v, i) => (idx[i] && v != null && v !== "" ? Number(v) : v))), widths: head.map((h) => (h === "day" ? 12 : h === "feature" ? 16 : 14)) };
}
export function ledgerSheet(head: string[], rows: (string | number | null | undefined)[][]): Sheet {
  const numeric = new Set(["units", "count", "inr", "amount", "fxToInr"]);
  const idx = head.map((h) => numeric.has(h));
  return { name: "Ledger", head, rows: rows.map((r) => r.map((v, i) => (idx[i] && v != null && v !== "" ? Number(v) : v))), widths: head.map((h) => (h === "at" ? 22 : h === "ref" || h === "note" || h === "userId" ? 28 : 13)) };
}

/* ---------- PDF text ---------- */

/** Helvetica is WinAnsi: no rupee sign, no arrows. Money is written "Rs 1,234"; anything the font cannot show becomes "?". */
export function pdfSafe(s: string) {
  return s
    .replace(/\u20b9/g, "Rs ")
    .replace(/\u00d7/g, "x")
    .replace(/[\u2192\u2794]/g, "->")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\u0009\u000a\u000d\u0020-\u007e\u00a0-\u00ff]/g, "?");
}
export const pdfInr = (minor: number) => pdfSafe(fmtInr(minor));

/** Greedy word wrap with a measuring function (pdf-lib's widthOfTextAtSize). Long words are split at the width. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= maxWidth) { line = next; continue; }
      if (line) out.push(line);
      line = word;
      while (measure(line) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

export interface ReportTable { title: string; head: string[]; rows: string[][]; widths: number[]; align?: ("l" | "r")[] }

/** The sections the PDF prints, in order. Breakdowns are capped at 12 lines so the report stays a page or two. */
export function reportSections(o: Overview, recs: Recommendation[], now: Date): { title: string; subtitle: string; kpis: [string, string][]; tables: ReportTable[]; footer: string } {
  const slice = (rows: Overview["byProvider"]) => rows.slice(0, 12).map((s) => [s.label, pdfInr(s.inrMinor), `${s.pct}%`, String(s.count)]);
  const kpis: [string, string][] = [
    ["Spend in range", pdfInr(o.totalMinor)],
    ["Previous period", o.previousMinor == null ? "n/a" : pdfInr(o.previousMinor)],
    ["This month so far", pdfInr(o.month.variableMtdMinor + o.month.recurringBookedMinor)],
    ["Month-end forecast", `${pdfInr(o.month.forecast.projectedTotalMinor)} (${o.month.forecast.confidence})`],
    ["Recurring commitments", `${pdfInr(o.month.recurringMonthlyMinor)}/mo`],
  ];
  const tables: ReportTable[] = [
    { title: "By provider", head: ["Provider", "INR", "Share", "Events"], rows: slice(o.byProvider), widths: [0.46, 0.2, 0.14, 0.2], align: ["l", "r", "r", "r"] },
    { title: "By category", head: ["Category", "INR", "Share", "Events"], rows: slice(o.byCategory), widths: [0.46, 0.2, 0.14, 0.2], align: ["l", "r", "r", "r"] },
    { title: "By feature", head: ["Feature", "INR", "Share", "Events"], rows: slice(o.byFeature), widths: [0.46, 0.2, 0.14, 0.2], align: ["l", "r", "r", "r"] },
    { title: "Where the numbers come from", head: ["Source", "INR"], rows: (Object.keys(o.bySource) as CostSource[]).filter((k) => k !== "forecast").map((k) => [SOURCE_LABEL[k], pdfInr(o.bySource[k])]), widths: [0.6, 0.4], align: ["l", "r"] },
  ];
  if (o.budgets.length) tables.push({ title: "Budgets", head: ["Budget", "Scope", "Budget", "Spent", "Used"], rows: o.budgets.map((b) => [b.name, b.scope === "total" ? "everything" : `${b.scope}: ${b.scope === "category" ? CATEGORY_LABEL[b.key as CostCategoryId] ?? b.key : b.key}`, pdfInr(b.inrMinor), pdfInr(b.spentMinor), `${b.pct}%`]), widths: [0.3, 0.26, 0.16, 0.16, 0.12], align: ["l", "l", "r", "r", "r"] });
  if (recs.length) tables.push({ title: "Recommendations", head: ["", "What to do"], rows: recs.map((r) => [r.severity === "warn" ? "Act" : "Consider", pdfSafe(`${r.title}. ${r.body}${r.saveMinor ? ` (about ${fmtInr(r.saveMinor)})` : ""}`)]), widths: [0.12, 0.88], align: ["l", "l"] });
  const open = o.alerts.filter((a) => a.status === "open");
  if (open.length) tables.push({ title: "Open alerts", head: ["Raised", "Severity", "Alert"], rows: open.slice(0, 15).map((a) => [a.createdAt.slice(0, 10), a.severity, pdfSafe(`${a.title}. ${a.body}`)]), widths: [0.14, 0.12, 0.74], align: ["l", "l", "l"] });
  return {
    title: "Infrastructure & Costs",
    subtitle: `${o.range.from} to ${o.range.to}${o.trackingSince ? `, tracking since ${o.trackingSince}` : ""}`,
    kpis,
    tables,
    footer: pdfSafe(`Generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC by Outlly. INR at the FX recorded when each row was written; estimates are Outlly's own calculation from usage and the unit prices on file, billed rows are provider invoices. A forecast is a projection, not a bill.`),
  };
}
