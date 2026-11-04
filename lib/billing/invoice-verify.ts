import "server-only";
import { timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { formatMoney } from "./money";
import { INVOICE_NUMBER_RE, invoiceStatus, normalizeCode } from "./invoice-core";
import { invoiceVerifyCode } from "./invoice";

export type VerifyResult =
  | { match: false }
  | { match: true; number: string; amount: string; issued: string; billedTo: string; status: "Paid" | "Refunded" | "Test, not charged" | "Not confirmed" };

/** "naidu@gmail.com" -> "n••••@gmail.com": enough to recognise, not enough to harvest. */
const mask = (email: string) => {
  const [u, d] = email.split("@");
  return `${u.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d ?? ""}`;
};

/**
 * 1121: does this invoice number and code match one Outlly issued? A wrong code and an unknown number get the same
 * answer, so the page can't be used to find out which invoice numbers exist. A match shows only what is needed to
 * compare with the PDF in hand: amount, date, a masked email and the status.
 */
export async function verifyInvoice(numberRaw: string, codeRaw: string): Promise<VerifyResult> {
  const number = numberRaw.trim().toUpperCase();
  const code = normalizeCode(codeRaw);
  if (!INVOICE_NUMBER_RE.test(number) || !/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) return { match: false };
  const inv = await db.invoice.findUnique({ where: { number }, include: { payment: { select: { status: true, provider: true, sample: true } }, creditNote: { select: { id: true } } } });
  const want = invoiceVerifyCode(inv ?? { number, amountMinor: 0, currency: "INR", issuedAt: new Date(0), customerEmail: "" });
  const same = timingSafeEqual(Buffer.from(want), Buffer.from(code));
  if (!inv || !same) return { match: false };
  const s = invoiceStatus({ paymentStatus: inv.payment?.status ?? null, provider: inv.provider ?? inv.payment?.provider ?? null, sample: inv.payment?.sample, refunded: !!inv.creditNote });
  return {
    match: true,
    number: inv.number,
    amount: formatMoney(inv.amountMinor, inv.currency),
    issued: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(inv.issuedAt),
    billedTo: mask(inv.customerEmail),
    status: s === "PAID" ? "Paid" : s === "REFUNDED" ? "Refunded" : s === "TEST" ? "Test, not charged" : "Not confirmed",
  };
}
