import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { dayKey } from "./core";
import { recommendationsFor } from "./insights";
import { exportRows, overview } from "./overview";
import { dailySheet, ledgerSheet, pdfSafe, reportSections, summarySheet, wrapText, type ReportTable } from "./report-core";
import { xlsx } from "./xlsx";

/** R1333 Costs Phase 6: the Excel workbook (summary, daily rollup, ledger) and the PDF report for a date range. */
export async function costsWorkbook(from: string, to: string, now = new Date()) {
  const o = await overview({ from, to, now });
  const [recs, daily, events] = await Promise.all([recommendationsFor(o, now).catch(() => []), exportRows("daily", o.range.from, o.range.to), exportRows("events", o.range.from, o.range.to)]);
  return { bytes: xlsx([summarySheet(o, recs), dailySheet(daily.head, daily.rows), ledgerSheet(events.head, events.rows)], { title: `Outlly costs ${o.range.from} to ${o.range.to}`, created: now }), range: o.range };
}

const A4: [number, number] = [595.28, 841.89];
const M = 44;
const INK = rgb(0.07, 0.07, 0.08), MUTED = rgb(0.42, 0.42, 0.46), RULE = rgb(0.86, 0.86, 0.88), BAND = rgb(0.955, 0.955, 0.965);

class Pdf {
  page!: PDFPage;
  y = 0;
  constructor(readonly doc: PDFDocument, readonly fonts: { body: PDFFont; bold: PDFFont }, readonly footer: string) { this.newPage(); }
  get width() { return A4[0] - 2 * M; }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - M;
    this.page.drawText(this.footer, { x: M, y: 18, size: 7, font: this.fonts.body, color: MUTED, maxWidth: this.width, lineHeight: 9 });
  }
  need(h: number) { if (this.y - h < M + 24) this.newPage(); }
  text(s: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
    const size = o.size ?? 10, font = o.bold ? this.fonts.bold : this.fonts.body;
    for (const line of wrapText(pdfSafe(s), this.width, (t) => font.widthOfTextAtSize(t, size))) {
      this.need(size * 1.4);
      this.page.drawText(line, { x: M, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= size * 1.4;
    }
    this.y -= o.gap ?? 0;
  }
  kpis(items: [string, string][]) {
    const w = this.width / items.length;
    this.need(44);
    items.forEach(([label, value], i) => {
      const x = M + i * w;
      this.page.drawText(pdfSafe(label), { x, y: this.y - 9, size: 7.5, font: this.fonts.body, color: MUTED });
      this.page.drawText(pdfSafe(value), { x, y: this.y - 26, size: 12.5, font: this.fonts.bold, color: INK });
    });
    this.y -= 44;
  }
  table(t: ReportTable) {
    const size = 8.5, lh = 11.5, pad = 4;
    const cols = t.widths.map((f) => f * this.width);
    const draw = (cells: string[], bold: boolean, band: boolean) => {
      const font = bold ? this.fonts.bold : this.fonts.body;
      const lines = cells.map((c, i) => wrapText(pdfSafe(c), cols[i] - 2 * pad, (s) => font.widthOfTextAtSize(s, size)));
      const h = Math.max(...lines.map((l) => l.length)) * lh + 2 * pad;
      this.need(h);
      if (band) this.page.drawRectangle({ x: M, y: this.y - h, width: this.width, height: h, color: BAND });
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((line, li) => {
          const w = font.widthOfTextAtSize(line, size);
          const tx = (t.align?.[i] ?? "l") === "r" ? x + cols[i] - pad - w : x + pad;
          this.page.drawText(line, { x: tx, y: this.y - pad - (li + 1) * lh + 3, size, font, color: bold ? MUTED : INK });
        });
        x += cols[i];
      });
      this.y -= h;
      this.page.drawLine({ start: { x: M, y: this.y }, end: { x: M + this.width, y: this.y }, thickness: 0.5, color: RULE });
    };
    this.need(40);
    this.text(t.title, { size: 11, bold: true, gap: 2 });
    draw(t.head, true, false);
    if (!t.rows.length) this.text("Nothing in this range.", { size: 8.5, color: MUTED });
    t.rows.forEach((r, i) => draw(r, false, i % 2 === 1));
    this.y -= 12;
  }
}

export async function costsPdf(from: string, to: string, now = new Date()) {
  const o = await overview({ from, to, now });
  const recs = await recommendationsFor(o, now).catch(() => []);
  const r = reportSections(o, recs, now);
  const doc = await PDFDocument.create();
  doc.setTitle(`Outlly costs ${o.range.from} to ${o.range.to}`);
  doc.setAuthor("Outlly");
  doc.setCreationDate(now);
  const [body, bold] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  const p = new Pdf(doc, { body, bold }, r.footer);
  p.text(r.title, { size: 20, bold: true });
  p.text(r.subtitle, { size: 10, color: MUTED, gap: 10 });
  p.kpis(r.kpis);
  for (const t of r.tables) p.table(t);
  return { bytes: await doc.save(), range: o.range, pages: doc.getPageCount() };
}

export const exportName = (kind: string, from: string, to: string, ext: string) => `outlly-costs-${kind}-${from}-to-${to}.${ext}`;
export const parseRange = (sp: URLSearchParams) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to") ?? "") ? sp.get("to")! : dayKey(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("from") ?? "") ? sp.get("from")! : dayKey(new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * 86400_000));
  return { from, to };
};
