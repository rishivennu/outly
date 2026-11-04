import "server-only";
import { db } from "../db";
import { env } from "../env";
import { addMonths, addYears } from "date-fns";
import { formatMoney } from "./money";
import { razorpay } from "./providers";
import { describeRazorpayMethod, gatewayName } from "./overview-core";
import { invoiceStatus, linesFor, maskMethod, parseLines, verifyCode, type PriceMeta } from "./invoice-core";
import { renderInvoicePdf } from "./invoice-pdf";
import { getConfig } from "../settings";
import { sendEmail, templates } from "../email";

function issuerOf(json: string | null): { name?: string; address?: string; gstin?: string } | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Printed on every invoice and on the verify page. */
export const SUPPORT_EMAIL = "support@outlly.com";

export const invoiceVerifyCode = (inv: { number: string; amountMinor: number; currency: string; issuedAt: Date; customerEmail: string }) => verifyCode(env.AUTH_SECRET, inv);

/** 1121: how the payment was made, masked, read from the gateway once at issue time. Best effort: null on any failure. */
async function methodFor(p: { provider: string; providerRef: string | null; sample: boolean }, cfg: unknown): Promise<string | null> {
  if (p.sample || p.provider === "mock") return "Test checkout";
  if (p.provider === "youpi") return "UPI";
  if (p.provider !== "razorpay" || !p.providerRef) return null;
  try {
    const got = await Promise.race([razorpay.paymentFor(cfg as never, p.providerRef), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    return maskMethod(describeRazorpayMethod(got)?.label);
  } catch {
    return null;
  }
}

/** OUT-2026-000042. Sequential per year; retried on the rare unique collision between two parallel payments. */
async function nextNumber() {
  // The year in India time, the same clock the PDF prints dates in (1 Jan 00:00-05:30 IST is still the old year in UTC).
  const y = Number(new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
  const prefix = `OUT-${y}-`;
  const last = await db.invoice.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: "desc" }, select: { number: true } });
  const n = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(6, "0");
}

/** Idempotent: one invoice per successful payment, however many times a webhook fires. */
export async function issueInvoice(paymentId: string, opts: { email?: boolean } = { email: true }) {
  const existing = await db.invoice.findUnique({ where: { paymentId }, include: { payment: { select: { sample: true } } } });
  if (existing) {
    // 1121: a first send that failed is retried by the next webhook / return URL that lands here.
    const { payment, ...row } = existing;
    if (!row.emailedAt && opts.email !== false && !payment?.sample) await emailInvoice(row);
    return row;
  }
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { user: true, subscription: { include: { plan: true } } } });
  if (p.status !== "succeeded") throw new Error("Invoices are only issued for successful payments");
  // 1096: a top-up pack names the pack; a renewal reads like the plan it renews.
  const topUp = p.purpose === "topup" ? (() => { try { return JSON.parse(p.meta ?? "{}") as { label?: string }; } catch { return {}; } })() : null;
  const description = topUp ? `Top-up: ${topUp.label || "usage pack"}` : p.subscription ? `${p.subscription.plan.name} plan, 1 ${p.subscription.interval}${p.purpose === "renewal" ? " (renewal)" : ""}` : "Outlly subscription";
  // Copy what the PDF prints onto the invoice itself: it must read the same years later, after a
  // change of business details or tax rate, and after the customer deletes their account.
  const cfg = await getConfig("payments");
  const biz = cfg.business;
  // 1121: the period this payment pays for. A renewal has already moved the end on by one cycle.
  const sub = p.purpose === "topup" ? null : p.subscription;
  const periodEnd = sub?.currentPeriodEnd ?? null;
  const periodStart = !sub ? null : p.purpose === "renewal" ? (sub.interval === "year" ? addYears(sub.currentPeriodEnd, -1) : addMonths(sub.currentPeriodEnd, -1)) : sub.createdAt;
  // Price breakdown, only when checkout recorded one (Payment.meta on a plan payment) and it adds up to what was paid.
  let price: PriceMeta | null = null;
  if (p.purpose !== "topup" && p.meta) {
    try { price = JSON.parse(p.meta).price ?? null; } catch { price = null; }
  }
  const snapshot = {
    paidAt: p.updatedAt,
    // A stray mandate charge doesn't move the period on, so a period already over when it was paid isn't printed.
    periodStart: periodStart && periodEnd && periodStart < periodEnd && periodEnd > p.updatedAt ? periodStart : null,
    periodEnd: periodStart && periodEnd && periodStart < periodEnd && periodEnd > p.updatedAt ? periodEnd : null,
    method: await methodFor(p, cfg),
    lines: JSON.stringify(linesFor({ description, amountMinor: p.amountMinor, price })),
    provider: p.provider,
    providerRef: p.providerRef,
    taxPercent: biz.taxPercent || 0,
    issuer: JSON.stringify({ name: biz.name || "Outlly", address: biz.address || "", gstin: biz.gstin || "" }),
  };
  let inv = null;
  for (let i = 0; i < 4 && !inv; i++) {
    try {
      inv = await db.invoice.create({
        data: { number: await nextNumber(), paymentId, userId: p.userId, customerName: p.user.name, customerEmail: p.user.email, description, amountMinor: p.amountMinor, currency: p.currency, ...snapshot },
      });
    } catch (e: any) {
      if (e?.code !== "P2002") throw e;
      const again = await db.invoice.findUnique({ where: { paymentId } });
      if (again) return again;
    }
  }
  if (!inv) throw new Error("Could not allocate an invoice number");
  if (opts.email !== false && !p.sample) await emailInvoice(inv);
  return inv;
}

/** Send the invoice with its PDF. Never throws: the invoice exists either way and a later call retries the send. */
async function emailInvoice(inv: { id: string; number: string; customerName: string; customerEmail: string; amountMinor: number; currency: string; description: string }) {
  try {
    const pdf = await invoicePdf(inv.id);
    const r = await sendEmail({
      to: inv.customerEmail,
      subject: `Your Outlly invoice ${inv.number}`,
      kind: "invoice",
      html: templates.invoice({ name: inv.customerName, number: inv.number, amount: formatMoney(inv.amountMinor, inv.currency), plan: inv.description, url: `${env.APP_URL}/billing` }),
      attachments: [{ filename: `${inv.number}.pdf`, content: pdf }],
    });
    if (r.ok) await db.invoice.update({ where: { id: inv.id }, data: { emailedAt: new Date() } });
  } catch (e) {
    console.error("[billing] invoice email failed", inv.number, e);
  }
}

export async function invoicePdf(invoiceId: string): Promise<Buffer> {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payment: true, creditNote: { select: { id: true } } } });
  // Invoices issued before the snapshot columns existed fall back to today's settings and the payment row.
  const live = (await getConfig("payments")).business;
  const kept = issuerOf(inv.issuer);
  const biz = { name: kept?.name ?? live.name, address: kept?.address ?? live.address, gstin: kept?.gstin ?? live.gstin, taxPercent: inv.taxPercent ?? live.taxPercent };
  const provider = inv.provider ?? inv.payment?.provider ?? "";
  const providerRef = inv.providerRef ?? inv.payment?.providerRef ?? null;
  // 1121: the badge reads the payment record. Only a gateway-confirmed payment is PAID; mock and sample are TEST.
  const status = invoiceStatus({ paymentStatus: inv.payment?.status ?? null, provider, sample: inv.payment?.sample, refunded: !!inv.creditNote });
  // Stored lines are only printed when they still add up to what was paid; otherwise one honest line.
  const stored = parseLines(inv.lines);
  const lines = stored && stored.reduce((a, l) => a + l.amountMinor, 0) === inv.amountMinor ? stored : linesFor({ description: inv.description, amountMinor: inv.amountMinor });
  const pdf = await renderInvoicePdf({
    number: inv.number,
    issuedAt: inv.issuedAt,
    paidAt: inv.paidAt ?? (inv.payment?.status === "succeeded" || inv.payment?.status === "refunded" ? inv.payment.updatedAt : null),
    periodStart: inv.periodStart,
    periodEnd: inv.periodEnd,
    oneOff: inv.payment?.purpose === "topup" || inv.description.startsWith("Top-up:"),
    status,
    customer: { name: inv.customerName, email: inv.customerEmail },
    issuer: { name: biz.name || "Outlly", address: biz.address || null, gstin: biz.gstin || null },
    lines,
    taxPercent: biz.taxPercent || 0,
    totalMinor: inv.amountMinor,
    currency: inv.currency,
    method: inv.method,
    gateway: provider ? gatewayName(provider) : null,
    providerRef,
    verify: { code: invoiceVerifyCode(inv), url: `${env.APP_URL}/verify-invoice` },
    support: { email: SUPPORT_EMAIL, website: new URL(env.APP_URL).host },
  });
  return Buffer.from(pdf);
}
