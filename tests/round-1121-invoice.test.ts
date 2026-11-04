/**
 * 1121: invoice PDF redesign. The status badge is read from the payment (never PAID unless the gateway confirmed it),
 * the table adds up to the total, the price breakdown is only trusted when it adds up, card and UPI details are
 * masked, the tamper code catches edits, and the PDF is a real A4 file with its fonts embedded.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { invoiceStatus, linesFor, maskMethod, normalizeCode, parseLines, totalsFor, verifyCode, INVOICE_NUMBER_RE, type InvoiceStatus } from "../lib/billing/invoice-core";
import { invoiceMoney, renderInvoicePdf, type InvoiceDoc } from "../lib/billing/invoice-pdf";

describe("status badge", () => {
  const S = (paymentStatus: string | null, provider: string | null, extra: { sample?: boolean; refunded?: boolean } = {}) => invoiceStatus({ paymentStatus, provider, sample: extra.sample, refunded: !!extra.refunded });
  test("only a confirmed real payment is PAID", () => {
    expect(S("succeeded", "razorpay")).toBe("PAID");
    expect(S("pending", "razorpay")).toBe("PENDING");
    expect(S("failed", "razorpay")).toBe("FAILED");
    expect(S("succeeded", "mock")).toBe("TEST");
    expect(S("succeeded", "razorpay", { sample: true })).toBe("TEST");
    expect(S("refunded", "razorpay")).toBe("REFUNDED");
    expect(S("succeeded", "razorpay", { refunded: true })).toBe("REFUNDED");
  });
  test("never PAID for pending, failed, mock or sample, whatever else is set", () => {
    for (const st of ["pending", "failed"]) for (const pr of ["razorpay", "youpi", "stripe", "mock"]) expect(S(st, pr)).not.toBe("PAID");
    // A status the gateway may one day send (and we don't know) is never PAID either: PAID is an allowlist.
    for (const st of ["authorized", "created", "disputed", ""]) expect(S(st, "razorpay")).not.toBe("PAID");
    for (const st of ["succeeded", "pending", "failed", null]) {
      expect(S(st, "mock")).not.toBe("PAID");
      expect(S(st, "razorpay", { sample: true })).not.toBe("PAID");
    }
  });
});

describe("table and totals", () => {
  test("net lines plus tax always equal the total, to the paisa", () => {
    for (const total of [1, 99, 49900, 79900, 4999900, 12345]) {
      for (const tax of [0, 5, 12, 18, 28]) {
        const lines = linesFor({ description: "Pro plan", amountMinor: total, price: { listMinor: total + 2001, discounts: [{ label: "Founding", minor: 2001 }] } });
        const t = totalsFor(lines, tax, total);
        expect(t.net.reduce((a, n) => a + n, 0) + t.tax).toBe(total);
        expect(t.subtotal + t.discounts + t.tax).toBe(total);
        expect(t.discounts).toBeLessThanOrEqual(0);
      }
    }
  });
  test("a breakdown is used only when it adds up to what was paid", () => {
    const ok = linesFor({ description: "Pro plan, 1 month", amountMinor: 79900, price: { listMinor: 99900, discounts: [{ label: "Founding member discount (20%)", minor: 20000 }] } });
    expect(ok.map((l) => l.kind)).toEqual(["plan", "discount"]);
    expect(ok.reduce((a, l) => a + l.amountMinor, 0)).toBe(79900);
    const off = linesFor({ description: "Pro plan", amountMinor: 79900, price: { listMinor: 99900, discounts: [{ label: "x", minor: 100 }] } });
    expect(off).toEqual([{ kind: "plan", description: "Pro plan", qty: 1, unitMinor: 79900, amountMinor: 79900 }]);
    expect(linesFor({ description: "Pro plan", amountMinor: 500, price: { listMinor: 600, discounts: [{ label: "neg", minor: -100 }] } })).toHaveLength(1);
    expect(linesFor({ description: "Pro plan", amountMinor: 500, price: null })).toHaveLength(1);
  });
  test("stored lines are validated before they are printed", () => {
    expect(parseLines(null)).toBeNull();
    expect(parseLines("not json")).toBeNull();
    expect(parseLines("[]")).toBeNull();
    expect(parseLines(JSON.stringify([{ kind: "hack", description: "x", qty: 1, unitMinor: 1, amountMinor: 1 }]))).toBeNull();
    expect(parseLines(JSON.stringify([{ kind: "plan", description: "x", qty: 1.5, unitMinor: 1, amountMinor: 1 }]))).toBeNull();
    expect(parseLines(JSON.stringify([{ kind: "plan", description: "x", qty: 1, unitMinor: 1, amountMinor: 1 }]))).toHaveLength(1);
  });
  test("money on an invoice always shows two decimals and only spaces the font has", () => {
    expect(invoiceMoney(79900, "INR")).toBe("₹799.00");
    expect(invoiceMoney(123456, "USD")).toBe("$1,234.56");
    expect(invoiceMoney(4999900, "INR")).toBe("₹49,999.00");
    for (const c of ["INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD", "AED"]) expect(invoiceMoney(100, c)).not.toMatch(/[\u202f\u2009\u2007]/);
  });
});

describe("masking", () => {
  test("UPI ids and long numbers never print in full", () => {
    expect(maskMethod("UPI · rishi.v@okhdfc")).toBe("UPI · ri•••@okhdfc");
    expect(maskMethod("Card 4111111111111111")).toBe("Card •••• 1111");
    expect(maskMethod("Visa debit •••• 4242")).toBe("Visa debit •••• 4242");
    expect(maskMethod(null)).toBeNull();
  });
});

describe("tamper code", () => {
  const inv = { number: "OUT-2026-000042", amountMinor: 79900, currency: "INR", issuedAt: new Date("2026-11-04T08:30:00Z"), customerEmail: "Rishi@Example.com" };
  const secret = "s".repeat(40);
  test("stable, readable, and changes when any printed fact changes", () => {
    const c = verifyCode(secret, inv);
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(verifyCode(secret, { ...inv })).toBe(c);
    expect(verifyCode(secret, { ...inv, customerEmail: " rishi@example.com " })).toBe(c);
    expect(verifyCode(secret, { ...inv, amountMinor: 7990 })).not.toBe(c);
    expect(verifyCode(secret, { ...inv, number: "OUT-2026-000043" })).not.toBe(c);
    expect(verifyCode(secret, { ...inv, currency: "USD" })).not.toBe(c);
    expect(verifyCode(secret, { ...inv, issuedAt: new Date("2026-11-05T08:30:00Z") })).not.toBe(c);
    expect(verifyCode("t".repeat(40), inv)).not.toBe(c);
    expect(normalizeCode(c.toLowerCase().replace(/-/g, " "))).toBe(c);
    expect(INVOICE_NUMBER_RE.test("OUT-2026-000042")).toBe(true);
    expect(INVOICE_NUMBER_RE.test("OUT-2026-42")).toBe(false);
  });
});

const doc = (over: Partial<InvoiceDoc> = {}): InvoiceDoc => ({
  number: "OUT-2026-000042",
  issuedAt: new Date("2026-11-04T08:30:00Z"),
  paidAt: new Date("2026-11-04T08:30:00Z"),
  periodStart: new Date("2026-11-04T08:30:00Z"),
  periodEnd: new Date("2026-12-04T08:30:00Z"),
  status: "PAID",
  customer: { name: "Rishi Vennu", email: "rishi@example.com" },
  issuer: { name: "Outlly", address: "Bengaluru", gstin: "29ABCDE1234F1Z5" },
  lines: linesFor({ description: "Pro plan, 1 month", amountMinor: 79900 }),
  taxPercent: 18,
  totalMinor: 79900,
  currency: "INR",
  method: "UPI",
  gateway: "Razorpay",
  providerRef: "pay_123",
  verify: { code: "ABCD-EFGH-JKLM", url: "https://www.outlly.com/verify-invoice" },
  support: { email: "support@outlly.com", website: "www.outlly.com" },
  ...over,
});

describe("the PDF", () => {
  test("A4 portrait, fonts embedded, status and code in the metadata", async () => {
    const bytes = await renderInvoicePdf(doc());
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
    expect(pdf.getSubject()).toBe("PAID invoice for ₹799.00");
    expect(pdf.getKeywords()).toContain("verify:ABCD-EFGH-JKLM");
    // Embedded TrueType programs: one per font (body, medium, display), inside the compressed object streams.
    const embedded = pdf.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of("FontFile2")));
    expect(embedded.length).toBe(3);
  });
  test("every status renders, and odd input (long text, other scripts, no period) doesn't break it", async () => {
    for (const status of ["PAID", "PENDING", "FAILED", "REFUNDED", "TEST"] as InvoiceStatus[]) {
      const pdf = await PDFDocument.load(await renderInvoicePdf(doc({ status })));
      expect(pdf.getSubject()!.startsWith(status)).toBe(true);
    }
    const odd = await renderInvoicePdf(
      doc({ customer: { name: "राज Kumar 😀 ".repeat(8), email: `${"x".repeat(80)}@example.com`, address: "A very long address ".repeat(12) }, periodStart: null, periodEnd: null, method: null, providerRef: null, taxPercent: 0 }),
    );
    expect((await PDFDocument.load(odd)).getPageCount()).toBe(1);
    // A name wholly in a script the font lacks prints the email in its place, never an empty Billed To.
    const hindi = await renderInvoicePdf(doc({ customer: { name: "राज कुमार", email: "raj@example.com" } }));
    expect((await PDFDocument.load(hindi)).getPageCount()).toBe(1);
    expect(readFileSync("lib/billing/invoice-pdf.ts", "utf8")).toContain("w.clean(raw, display).trim() ? raw : d.customer.email");
  });
  test("many lines flow onto a second page instead of running off the first", async () => {
    const lines = Array.from({ length: 16 }, (_, i) => ({ kind: "addon" as const, description: `Add-on ${i + 1}`, qty: 1, unitMinor: 1000, amountMinor: 1000 }));
    const pdf = await PDFDocument.load(await renderInvoicePdf(doc({ lines, totalMinor: 16000 })));
    expect(pdf.getPageCount()).toBe(2);
  });
});

describe("Node buffers (Vercel)", () => {
  test("renders when base64 Buffers are views into a shared pool, like Node returns", async () => {
    // Bun hands back Buffers at offset 0; Node's start 32+ bytes into a pool, which broke pdf-lib's JPEG reader.
    const real = Buffer.from;
    (Buffer as any).from = (v: any, enc?: any) => {
      const b = real.call(Buffer, v, enc) as Buffer;
      if (enc !== "base64") return b;
      const pool = Buffer.alloc(b.length + 64);
      b.copy(pool, 32);
      return pool.subarray(32, 32 + b.length);
    };
    try {
      expect((Buffer.from("aGk=", "base64") as Buffer).byteOffset).toBe(32);
      expect((await PDFDocument.load(await renderInvoicePdf(doc()))).getPageCount()).toBe(1);
    } finally {
      (Buffer as any).from = real;
    }
  });
  test("no raw Buffer goes into a pdf-lib embed", () => {
    expect(readFileSync("lib/billing/invoice-pdf.ts", "utf8")).not.toMatch(/embed(Jpg|Png|Font)\(Buffer\.from/);
  });
});

describe("wiring", () => {
  const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  test("the old hardcoded PAID renderer is gone and the page is public", () => {
    const inv = src("lib/billing/invoice.ts");
    expect(inv).not.toContain('"PAID"');
    expect(inv).toContain("invoiceStatus(");
    expect(src("middleware.ts")).toMatch(/const OPEN = \[[^\]]*"\/verify-invoice"/);
    expect(src("app/api/invoices/verify/route.ts")).toContain("auth: false, limit: [10");
  });
});

let db: typeof import("../lib/db").db;
let invoice: typeof import("../lib/billing/invoice");
let verify: typeof import("../lib/billing/invoice-verify");
let n = 0;
beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  invoice = await import("../lib/billing/invoice");
  verify = await import("../lib/billing/invoice-verify");
}, 60_000);
const mk = () => db.user.create({ data: { name: "Inv 1121", email: `inv1121-${++n}-${Date.now()}@test.dev`, passwordHash: "hashed-secret" } });

describe("issue and verify (test DB)", () => {
  test("an invoice keeps the paid time, method, breakdown and period", async () => {
    const u = await mk();
    const plan = await db.plan.findFirst({ where: { priceMinor: { gt: 0 } } });
    const sub = plan ? await db.subscription.create({ data: { userId: u.id, planId: plan.id, status: "active", priceMinor: 49900, currency: "INR", interval: "month", provider: "youpi", currentPeriodEnd: new Date(Date.now() + 30 * 86400_000) } }) : null;
    const meta = JSON.stringify({ price: { listMinor: 59900, discounts: [{ label: "Founding member discount (20%)", minor: 10000 }] } });
    const p = await db.payment.create({ data: { userId: u.id, subscriptionId: sub?.id, planId: plan?.id, amountMinor: 49900, currency: "INR", provider: "youpi", providerRef: `v1121-${Date.now()}-${n}`, status: "succeeded", meta } });
    const inv = await invoice.issueInvoice(p.id, { email: false });
    expect(inv.paidAt?.getTime()).toBe(p.updatedAt.getTime());
    expect(inv.method).toBe("UPI");
    expect(parseLines(inv.lines)!.map((l) => l.amountMinor)).toEqual([59900, -10000]);
    if (sub) expect(inv.periodEnd?.getTime()).toBe(sub.currentPeriodEnd.getTime());
    const pdf = await PDFDocument.load(await invoice.invoicePdf(inv.id));
    expect(pdf.getSubject()).toStartWith("PAID ");
    // The same invoice after a refund: the badge follows the payment.
    await db.payment.update({ where: { id: p.id }, data: { status: "refunded" } });
    expect((await PDFDocument.load(await invoice.invoicePdf(inv.id))).getSubject()).toStartWith("REFUNDED ");

    const code = invoice.invoiceVerifyCode(inv);
    const ok = await verify.verifyInvoice(inv.number.toLowerCase(), code.toLowerCase());
    expect(ok).toMatchObject({ match: true, number: inv.number, status: "Refunded" });
    expect(JSON.stringify(ok)).not.toContain(u.email);
    const swapped = code.slice(0, -1) + (code.endsWith("A") ? "B" : "A");
    expect(await verify.verifyInvoice(inv.number, swapped)).toEqual({ match: false });
    expect(await verify.verifyInvoice("OUT-2099-999999", code)).toEqual({ match: false });
    expect(await verify.verifyInvoice("junk", "junk")).toEqual({ match: false });
  });
  test("a test checkout invoice says TEST, never PAID", async () => {
    const u = await mk();
    const p = await db.payment.create({ data: { userId: u.id, amountMinor: 49900, currency: "INR", provider: "mock", providerRef: `m1121-${Date.now()}-${n}`, status: "succeeded" } });
    const inv = await invoice.issueInvoice(p.id, { email: false });
    expect(inv.method).toBe("Test checkout");
    expect((await PDFDocument.load(await invoice.invoicePdf(inv.id))).getSubject()).toStartWith("TEST ");
  });
});
