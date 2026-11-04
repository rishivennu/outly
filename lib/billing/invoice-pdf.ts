import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { INVOICE_FONT_BODY, INVOICE_FONT_DISPLAY, INVOICE_FONT_MEDIUM } from "./invoice-fonts";
import { INVOICE_LOGO_JPG, INVOICE_MARK_PNG } from "./invoice-art";
import { STATUS_NOTE, totalsFor, type InvoiceLine, type InvoiceStatus } from "./invoice-core";

/**
 * 1121: the invoice PDF. Pure (no database), so it renders the same in tests, in the download route and in email.
 * A4 portrait, fonts and logo embedded, every string measured: long text wraps or ends in an ellipsis, nothing clips.
 * Everything printed comes from the InvoiceDoc, which lib/billing/invoice.ts builds from the stored invoice row.
 */
export interface InvoiceDoc {
  number: string;
  issuedAt: Date;
  paidAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  /** A top-up pack: no service period by nature. Otherwise a missing period prints "Not recorded". */
  oneOff?: boolean;
  status: InvoiceStatus;
  customer: { name: string; email: string; address?: string | null };
  issuer: { name: string; address?: string | null; gstin?: string | null };
  lines: InvoiceLine[];
  taxPercent: number;
  totalMinor: number;
  currency: string;
  /** Masked: "Visa debit •••• 4242". Null when the gateway didn't say. */
  method: string | null;
  gateway: string | null;
  providerRef: string | null;
  verify: { code: string; url: string };
  support: { email: string; website: string };
}

const W = 595.28;
const H = 841.89;
const M = 40;
const R = W - M;
const CW = R - M;
const FOOT = H - 40; // content never goes below this; the footer sits under it

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = { ink: hex("#080808"), lime: hex("#B5FF00"), forest: hex("#173A24"), cream: hex("#F5F1E5"), coral: hex("#ED7658"), grey: hex("#777777") };

/** The seller is in India: dates read in IST, so a 1 a.m. payment isn't dated the day before. */
const TZ = "Asia/Kolkata";
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
export const invoiceDate = (d: Date) => dateFmt.format(d);

const LOCALE: Record<string, string> = { INR: "en-IN", USD: "en-US", EUR: "en-IE", GBP: "en-GB" };
/** Always two decimals on an invoice. Thin and narrow spaces (some locales) become plain spaces the font has. */
export function invoiceMoney(minor: number, currency: string) {
  try {
    const s = new Intl.NumberFormat(LOCALE[currency] ?? "en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
    return s.replace(/[\u202f\u2009\u2007]/g, " ");
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

function period(a: Date | null, b: Date | null) {
  if (!a || !b) return null;
  const [da, db] = [invoiceDate(a), invoiceDate(b)];
  const ya = da.slice(-4);
  return ya === db.slice(-4) ? `${da.slice(0, -5)} – ${db}` : `${da} – ${db}`;
}

const BADGE: Record<InvoiceStatus, { bg: RGB | null; fg: RGB; border?: RGB }> = {
  PAID: { bg: C.lime, fg: C.ink },
  PENDING: { bg: C.cream, fg: C.ink },
  FAILED: { bg: C.coral, fg: C.ink },
  REFUNDED: { bg: null, fg: C.cream, border: C.cream },
  TEST: { bg: null, fg: C.cream, border: C.grey },
};

class Writer {
  private sets = new Map<PDFFont, Set<number>>();
  page!: PDFPage;
  constructor(
    readonly doc: PDFDocument,
    readonly f: { body: PDFFont; med: PDFFont; display: PDFFont },
  ) {}

  /** Keeps only characters the embedded font can draw: accents fold to their letter, anything else is dropped. */
  clean(s: string, font: PDFFont) {
    let set = this.sets.get(font);
    if (!set) this.sets.set(font, (set = new Set(font.getCharacterSet())));
    let out = "";
    for (const ch of (s ?? "").normalize("NFC").replace(/[\r\n\t]+/g, " ")) {
      if (set.has(ch.codePointAt(0)!)) out += ch;
      else {
        const base = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
        if (base && [...base].every((c) => set!.has(c.codePointAt(0)!))) out += base;
      }
    }
    return out.replace(/\s{2,}/g, " ").trim();
  }

  width(s: string, font: PDFFont, size: number) {
    return font.widthOfTextAtSize(s, size);
  }

  /** The largest size from `size` down to `min` at which the text fits `max` points (then `fit` trims the rest). */
  shrink(s: string, font: PDFFont, size: number, min: number, max: number) {
    const w = this.width(this.clean(s, font), font, size);
    return w <= max ? size : Math.max(min, Math.floor(((size * max) / w) * 4) / 4);
  }

  /** Shortens to fit `max` points, ending in an ellipsis. */
  fit(s: string, font: PDFFont, size: number, max: number) {
    if (this.width(s, font, size) <= max) return s;
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.width(s.slice(0, mid).trimEnd() + "…", font, size) <= max) lo = mid;
      else hi = mid - 1;
    }
    return s.slice(0, lo).trimEnd() + "…";
  }

  /** Word wrap to `lines` lines at most; a word longer than the line is broken; the last line ends in an ellipsis. */
  wrap(raw: string, font: PDFFont, size: number, max: number, lines: number) {
    const s = this.clean(raw, font);
    const out: string[] = [];
    let cur = "";
    const words = s.split(" ").filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      let w = words[i];
      while (this.width(w, font, size) > max) {
        let n = w.length - 1;
        while (n > 1 && this.width(w.slice(0, n), font, size) > max) n--;
        if (cur) (out.push(cur), (cur = ""));
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      const next = cur ? `${cur} ${w}` : w;
      if (this.width(next, font, size) <= max) cur = next;
      else (out.push(cur), (cur = w));
    }
    if (cur) out.push(cur);
    if (out.length > lines) {
      const keep = out.slice(0, lines);
      keep[lines - 1] = this.fit(`${keep[lines - 1]} ${out.slice(lines).join(" ")}`, font, size, max);
      return keep;
    }
    return out;
  }

  /** `top` is the baseline, measured from the top of the page. */
  text(s: string, x: number, top: number, size: number, font: PDFFont, color: RGB, o: { align?: "left" | "right"; max?: number; opacity?: number } = {}) {
    let t = this.clean(s, font);
    if (o.max) t = this.fit(t, font, size, o.max);
    if (!t) return 0;
    const w = this.width(t, font, size);
    this.page.drawText(t, { x: o.align === "right" ? x - w : x, y: H - top, size, font, color, opacity: o.opacity });
    return w;
  }

  /** Rounded rectangle; x/top/w/h in top-down page units (SVG paths in pdf-lib run y-down from the given origin). */
  box(x: number, top: number, w: number, h: number, r: number, o: { fill?: RGB; border?: RGB; borderWidth?: number; opacity?: number }) {
    r = Math.min(r, w / 2, h / 2);
    const k = r * 0.5523; // circle-to-bezier constant
    const p = [
      `M ${x + r} ${top}`, `L ${x + w - r} ${top}`, `C ${x + w - r + k} ${top} ${x + w} ${top + r - k} ${x + w} ${top + r}`,
      `L ${x + w} ${top + h - r}`, `C ${x + w} ${top + h - r + k} ${x + w - r + k} ${top + h} ${x + w - r} ${top + h}`,
      `L ${x + r} ${top + h}`, `C ${x + r - k} ${top + h} ${x} ${top + h - r + k} ${x} ${top + h - r}`,
      `L ${x} ${top + r}`, `C ${x} ${top + r - k} ${x + r - k} ${top} ${x + r} ${top}`, "Z",
    ].join(" ");
    this.page.drawSvgPath(p, { x: 0, y: H, color: o.fill, borderColor: o.border, borderWidth: o.border ? (o.borderWidth ?? 0.75) : 0, opacity: o.opacity, borderOpacity: o.opacity });
  }

  rule(x1: number, x2: number, top: number, color: RGB, opacity = 0.14, thickness = 0.6) {
    this.page.drawLine({ start: { x: x1, y: H - top }, end: { x: x2, y: H - top }, thickness, color, opacity });
  }
}

// Ligatures off: the subset fonts keep their GSUB table, and a ligature glyph ("fi") would print as a gap.
/**
 * Base64 to a byte array that owns its whole buffer. Node's Buffer.from(…, "base64") can return a view 32+ bytes into a
 * shared pool, and pdf-lib's JPEG reader looks at `.buffer` from 0 ("SOI not found in JPEG"). Bun starts at 0, so tests
 * pass there while every invoice 500s on Vercel. Always copy.
 */
export const pdfBytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

const loadFont = (doc: PDFDocument, b64: string) => doc.embedFont(pdfBytes(b64), { subset: false, features: { liga: false, dlig: false, clig: false } });

export async function renderInvoicePdf(d: InvoiceDoc): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [body, med, display] = await Promise.all([loadFont(doc, INVOICE_FONT_BODY), loadFont(doc, INVOICE_FONT_MEDIUM), loadFont(doc, INVOICE_FONT_DISPLAY)]);
  const [logo, mark] = await Promise.all([doc.embedJpg(pdfBytes(INVOICE_LOGO_JPG)), doc.embedPng(pdfBytes(INVOICE_MARK_PNG))]);
  const w = new Writer(doc, { body, med, display });
  const pages: PDFPage[] = [];
  const newPage = () => {
    w.page = doc.addPage([W, H]);
    w.page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.cream });
    pages.push(w.page);
  };
  newPage();

  // ---- Header: black band, logo, status, the big editorial word, then number / date / seller.
  const HEAD = 266;
  w.page.drawRectangle({ x: 0, y: H - HEAD, width: W, height: HEAD, color: C.ink });
  // Minimal geometry: one lime ring cut by the right edge, below the badge.
  w.page.drawCircle({ x: W + 8, y: H - 152, size: 82, borderColor: C.lime, borderWidth: 1, borderOpacity: 0.55 });
  w.page.drawImage(logo, { x: M, y: H - 78, width: 40, height: 40 });
  w.text("Outlly", M + 52, 56, 15, med, C.cream);
  w.text("Create once. Publish everywhere.", M + 52, 71, 8.5, body, C.grey);

  const b = BADGE[d.status];
  const bw = w.width(d.status, med, 9) + 34;
  w.box(R - bw, 40, bw, 24, 12, { fill: b.bg ?? undefined, border: b.border });
  w.page.drawCircle({ x: R - bw + 14, y: H - 52, size: 3, color: b.fg });
  w.text(d.status, R - 13, 55.5, 9, med, b.fg, { align: "right" });

  const word = "INVOICE";
  const size = Math.min(112, (CW - 34) / w.width(word, display, 1));
  const ww = w.text(word, M - 3, 178, size, display, C.cream);
  w.page.drawCircle({ x: M - 3 + ww + 14, y: H - 178 + 8, size: 8, color: C.lime });

  w.rule(M, R, 196, C.cream, 0.18);
  const cols = [M, M + 150, M + 272];
  w.text("INVOICE NO.", cols[0], 212, 7, med, C.grey);
  w.text(d.number, cols[0], 228, 10.5, med, C.cream, { max: 140 });
  w.text("ISSUED", cols[1], 212, 7, med, C.grey);
  w.text(invoiceDate(d.issuedAt), cols[1], 228, 10.5, med, C.cream, { max: 112 });
  w.text("FROM", cols[2], 212, 7, med, C.grey);
  const fromMax = R - cols[2];
  w.text(d.issuer.name || "Outlly", cols[2], 228, 10.5, med, C.cream, { max: fromMax });
  const fromLines = [...(d.issuer.address ? w.wrap(d.issuer.address, body, 7.5, fromMax, 2) : []), ...(d.issuer.gstin ? [`GSTIN ${d.issuer.gstin}`] : [])];
  fromLines.forEach((l, i) => w.text(l, cols[2], 241 + i * 10, 7.5, body, C.grey, { max: fromMax }));

  // ---- Billed to (coral panel) and the details list.
  let y = HEAD + 24;
  const panelW = 300;
  const addr = d.customer.address ? w.wrap(d.customer.address, body, 9, panelW - 40, 2) : [];
  const panelH = 92 + addr.length * 12;
  w.box(M, y, panelW, panelH, 18, { fill: C.coral });
  w.text("BILLED TO", M + 20, y + 26, 7.5, med, C.ink, { opacity: 0.75 });
  // The customer's own name and email shrink to fit before anything is cut.
  // A name the embedded font can't draw at all (Devanagari, CJK...) would print as nothing: use the email instead.
  const raw = d.customer.name || d.customer.email;
  const who = w.clean(raw, display).trim() ? raw : d.customer.email;
  w.text(who, M + 20, y + 52, w.shrink(who, display, 19, 12, panelW - 40), display, C.ink, { max: panelW - 40 });
  w.text(d.customer.email, M + 20, y + 72, w.shrink(d.customer.email, body, 10, 7, panelW - 40), body, C.ink, { max: panelW - 40 });
  addr.forEach((l, i) => w.text(l, M + 20, y + 88 + i * 12, 9, body, C.ink));

  const dx = M + panelW + 24;
  w.text("DETAILS", dx, y + 26, 7.5, med, C.grey);
  const unconfirmed = d.status === "PENDING" || d.status === "FAILED";
  const rows: [string, string][] = [
    ["Invoice number", d.number],
    ["Billing date", invoiceDate(d.issuedAt)],
    ["Payment date", d.paidAt && !unconfirmed ? invoiceDate(d.paidAt) : unconfirmed ? "Not confirmed" : "Not recorded"],
    ["Period", period(d.periodStart, d.periodEnd) ?? (d.oneOff ? "One-off" : "Not recorded")],
  ];
  rows.forEach(([k, v], i) => {
    const t = y + 46 + i * 17;
    w.text(k, dx, t, 8.5, body, C.grey);
    w.text(v, R, t, 8.5, med, C.ink, { align: "right", max: R - dx - 78 });
    if (i < rows.length - 1) w.rule(dx, R, t + 6.5, C.ink, 0.1);
  });
  y += Math.max(panelH, 112) + 24;

  // ---- The table. Amounts are without tax so the columns add up to the subtotal.
  const t = totalsFor(d.lines, d.taxPercent, d.totalMinor);
  const X = { desc: M + 16, qty: M + 330, unit: M + 420, amt: R - 16 };
  w.box(M, y, CW, 28, 10, { fill: C.forest });
  w.text("DESCRIPTION", X.desc, y + 18, 7.5, med, C.cream);
  w.text("QTY", X.qty, y + 18, 7.5, med, C.cream, { align: "right" });
  w.text("UNIT PRICE", X.unit, y + 18, 7.5, med, C.cream, { align: "right" });
  w.text("AMOUNT", X.amt, y + 18, 7.5, med, C.cream, { align: "right" });
  y += 28;
  d.lines.forEach((l, i) => {
    const desc = w.wrap(l.description, body, 10, X.qty - 40 - X.desc, 2);
    const h = 16 + desc.length * 13;
    if (y + h > FOOT - 20) (newPage(), (y = 50));
    const base = y + 20;
    desc.forEach((s, j) => w.text(s, X.desc, base + j * 13, 10, body, C.ink));
    const unit = Math.round(t.net[i] / l.qty);
    w.text(String(l.qty), X.qty, base, 10, body, C.ink, { align: "right" });
    w.text(invoiceMoney(unit, d.currency), X.unit, base, 10, body, C.ink, { align: "right" });
    w.text(invoiceMoney(t.net[i], d.currency), X.amt, base, 10, med, C.ink, { align: "right" });
    y += h;
    w.rule(M, R, y, C.ink, 0.12);
  });

  // ---- Payment summary (lime) beside the totals.
  y += 18;
  const SUM_H = 150;
  if (y + SUM_H + 110 > FOOT) (newPage(), (y = 50));
  const sw = 270;
  w.box(M, y, sw, SUM_H, 18, { fill: C.lime });
  w.page.drawCircle({ x: M + sw - 30, y: H - (y + 30), size: 10, borderColor: C.ink, borderWidth: 1, borderOpacity: 0.35 });
  w.text("PAYMENT SUMMARY", M + 20, y + 26, 7.5, med, C.forest);
  w.text(d.status === "PAID" ? "Total paid" : "Total", M + 20, y + 44, 8.5, body, C.forest);
  w.text(invoiceMoney(d.totalMinor, d.currency), M + 20, y + 72, 26, display, C.ink, { max: sw - 40 });
  const sum: [string, string][] = [
    ["Currency", d.currency.toUpperCase()],
    ["Status", d.status],
    ["Method", d.method || d.gateway || "Not recorded"],
    ["Reference", d.providerRef || "Not recorded"],
  ];
  sum.forEach(([k, v], i) => {
    const tt = y + 94 + i * 14;
    w.text(k, M + 20, tt, 8, body, C.forest);
    w.text(v, M + sw - 20, tt, 8, med, C.ink, { align: "right", max: sw - 110 });
  });

  const tx = M + sw + 30;
  const trow = (k: string, v: string, tt: number) => {
    w.text(k, tx, tt, 9, body, C.grey, { max: R - tx - 90 });
    w.text(v, R, tt, 9, med, C.ink, { align: "right" });
  };
  let ty = y + 16;
  trow("Subtotal", invoiceMoney(t.subtotal, d.currency), ty);
  if (t.discounts) trow("Discounts", invoiceMoney(t.discounts, d.currency), (ty += 19));
  trow(d.taxPercent > 0 ? `Tax (GST ${d.taxPercent}%, included)` : "Tax", invoiceMoney(t.tax, d.currency), (ty += 19));
  w.rule(tx, R, ty + 12, C.ink, 0.9, 0.9);
  w.text("Total", tx, ty + 36, 11, med, C.ink);
  w.text(invoiceMoney(d.totalMinor, d.currency), R, ty + 37, 18, display, C.ink, { align: "right", max: R - tx - 50 });
  w.wrap(STATUS_NOTE[d.status], body, 8.5, R - tx, 3).forEach((l, i) => w.text(l, tx, ty + 62 + i * 11.5, 8.5, body, C.grey));
  y += SUM_H + 18;

  // ---- Terms and help.
  const PH = 90;
  const termsW = 300;
  w.box(M, y, termsW, PH, 16, { border: C.ink, borderWidth: 0.75 });
  w.text("TERMS", M + 18, y + 22, 7.5, med, C.ink);
  const terms =
    d.status === "TEST"
      ? "A test checkout: no money moved and this is not a tax invoice. It shows what a real invoice will look like."
      : "Prices include tax where it applies. You can cancel any time in Billing: you keep the plan until the end of the period paid for. Refunds go back to the original payment method. This is a computer-generated invoice and needs no signature.";
  w.wrap(terms, body, 8, termsW - 36, 5).forEach((l, i) => w.text(l, M + 18, y + 38 + i * 10.5, 8, body, C.ink, { opacity: 0.8 }));
  const hx = M + termsW + 12;
  w.box(hx, y, R - hx, PH, 16, { fill: C.forest });
  w.text("NEED HELP?", hx + 18, y + 22, 7.5, med, C.lime);
  w.text(d.support.email, hx + 18, y + 44, 10, med, C.cream, { max: R - hx - 36 });
  w.text(d.support.website, hx + 18, y + 60, 9, body, C.cream, { max: R - hx - 36, opacity: 0.85 });
  w.text(`Quote ${d.number}`, hx + 18, y + 76, 8, body, C.cream, { max: R - hx - 36, opacity: 0.7 });

  // ---- Footer on every page: brand mark and the tamper check.
  pages.forEach((p, i) => {
    w.page = p;
    w.rule(M, R, FOOT + 4, C.ink, 0.12);
    p.drawImage(mark, { x: M, y: H - FOOT - 22, width: 13, height: 13 });
    w.text("Outlly", M + 18, FOOT + 19, 8.5, med, C.ink);
    w.text(`Verify at ${d.verify.url.replace(/^https?:\/\//, "")}  ·  code ${d.verify.code}`, R, FOOT + 19, 7.5, body, C.grey, { align: "right", max: 360 });
    if (pages.length > 1) w.text(`Page ${i + 1} of ${pages.length}`, (M + R) / 2 - 10, FOOT + 31, 7, body, C.grey);
  });

  doc.setTitle(`Invoice ${d.number}`);
  doc.setAuthor(d.issuer.name || "Outlly");
  doc.setSubject(`${d.status} invoice for ${invoiceMoney(d.totalMinor, d.currency)}`);
  doc.setKeywords([d.number, `verify:${d.verify.code}`]);
  doc.setCreator("Outlly billing");
  doc.setProducer("Outlly");
  doc.setCreationDate(d.issuedAt);
  doc.setModificationDate(d.issuedAt);
  return doc.save();
}
