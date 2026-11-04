import { createHmac } from "node:crypto";

/**
 * 1121: the facts an invoice prints, worked out without a database so they can be tested.
 *
 * Status is read from the payment record, never assumed. An invoice is only ever issued for a payment the gateway
 * confirmed (lib/billing/invoice.ts throws otherwise), but the badge still checks: a test checkout or sample payment
 * is TEST, a refund is REFUNDED, and anything the gateway hasn't confirmed is PENDING or FAILED, never PAID.
 */
export type InvoiceStatus = "PAID" | "PENDING" | "FAILED" | "REFUNDED" | "TEST";

export function invoiceStatus(p: { paymentStatus: string | null; provider: string | null; sample?: boolean; refunded: boolean }): InvoiceStatus {
  if (p.refunded || p.paymentStatus === "refunded") return "REFUNDED";
  if (p.sample || p.provider === "mock") return "TEST";
  if (p.paymentStatus === "failed") return "FAILED";
  // Succeeded, or the payment row is gone (the customer deleted their account): the invoice itself is the proof,
  // because it can only be created after the gateway confirmed the payment. Any other status is not PAID.
  if (p.paymentStatus === "succeeded" || p.paymentStatus === null) return "PAID";
  return "PENDING";
}

export const STATUS_NOTE: Record<InvoiceStatus, string> = {
  PAID: "Payment confirmed by the gateway.",
  PENDING: "Waiting for the gateway to confirm this payment.",
  FAILED: "This payment did not go through. Nothing was charged.",
  REFUNDED: "This payment was refunded in full. See the credit note.",
  TEST: "Test checkout. No money was charged.",
};

/** One row of the table, tax-inclusive, as charged. Discounts are negative. */
export interface InvoiceLine {
  kind: "plan" | "addon" | "discount";
  description: string;
  qty: number;
  unitMinor: number;
  amountMinor: number;
}

export function parseLines(json: string | null | undefined): InvoiceLine[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v) || !v.length) return null;
    const ok = v.every(
      (l) => l && ["plan", "addon", "discount"].includes(l.kind) && typeof l.description === "string" && Number.isInteger(l.qty) && l.qty > 0 && Number.isInteger(l.unitMinor) && Number.isInteger(l.amountMinor),
    );
    return ok ? (v as InvoiceLine[]) : null;
  } catch {
    return null;
  }
}

/**
 * What the checkout recorded about the price (Payment.meta on a plan payment): the list price and each discount
 * that took it down to what was charged. Only trusted when it adds up exactly to the amount paid.
 */
export interface PriceMeta {
  listMinor?: number;
  discounts?: { label: string; minor: number }[];
}

export function linesFor(p: { description: string; amountMinor: number; price?: PriceMeta | null }): InvoiceLine[] {
  const list = p.price?.listMinor;
  const discounts = (p.price?.discounts ?? []).filter((d) => d && typeof d.label === "string" && Number.isInteger(d.minor) && d.minor > 0);
  const off = discounts.reduce((a, d) => a + d.minor, 0);
  if (Number.isInteger(list) && discounts.length && list! - off === p.amountMinor && list! > 0) {
    return [
      { kind: "plan", description: p.description, qty: 1, unitMinor: list!, amountMinor: list! },
      ...discounts.map((d) => ({ kind: "discount" as const, description: d.label.slice(0, 80), qty: 1, unitMinor: -d.minor, amountMinor: -d.minor })),
    ];
  }
  // Nothing recorded (or it doesn't add up): one honest line for exactly what was paid.
  return [{ kind: "plan", description: p.description, qty: 1, unitMinor: p.amountMinor, amountMinor: p.amountMinor }];
}

export interface InvoiceTotals {
  /** Each line without tax, in the same order; they add up to total - tax exactly. */
  net: number[];
  subtotal: number;
  discounts: number;
  tax: number;
  total: number;
}

/** Prices include tax. Tax is worked out once from the total, and the rounding lands on the first line. */
export function totalsFor(lines: InvoiceLine[], taxPercent: number, totalMinor: number): InvoiceTotals {
  const t = taxPercent > 0 ? taxPercent : 0;
  const tax = Math.round((totalMinor * t) / (100 + t));
  const net = lines.map((l) => Math.round((l.amountMinor * 100) / (100 + t)));
  const drift = totalMinor - tax - net.reduce((a, n) => a + n, 0);
  if (net.length) net[0] += drift;
  const subtotal = lines.reduce((a, l, i) => (l.kind === "discount" ? a : a + net[i]), 0);
  const discounts = lines.reduce((a, l, i) => (l.kind === "discount" ? a + net[i] : a), 0);
  return { net, subtotal, discounts, tax, total: totalMinor };
}

/** "UPI · rishi@okhdfc" -> "UPI · ri•••@okhdfc". Card labels already carry only the last four digits. */
export function maskMethod(label: string | null | undefined): string | null {
  if (!label) return null;
  const s = label.replace(/\d{5,}/g, (d) => `•••• ${d.slice(-4)}`);
  return s.replace(/([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+)/g, (_m, u: string, d: string) => `${u.slice(0, 2)}•••@${d}`).slice(0, 60);
}

/**
 * Tamper check. A keyed hash of the facts that matter (number, amount, currency, issue time, customer), printed on
 * the PDF. Anyone can check a PDF at /verify-invoice: an edited amount or number won't match what Outlly issued.
 */
export function verifyCode(secret: string, inv: { number: string; amountMinor: number; currency: string; issuedAt: Date; customerEmail: string }): string {
  const msg = [inv.number, inv.amountMinor, inv.currency.toUpperCase(), inv.issuedAt.toISOString(), inv.customerEmail.trim().toLowerCase()].join("|");
  const mac = createHmac("sha256", `invoice-verify:${secret}`).update(msg).digest();
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let out = "";
  for (let i = 0; i < 12; i++) out += A[mac[i] % 32];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})(.{4})$/, "$1-$2-$3");
export const INVOICE_NUMBER_RE = /^OUT-\d{4}-\d{6}$/;
