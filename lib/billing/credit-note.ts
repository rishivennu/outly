import "server-only";
import { db } from "../db";
import { Pdf } from "./pdf";
import { INVOICE_LOGO_JPEG } from "./logo";
import { formatMoney } from "./money";

/**
 * Credit notes (1049). A refund cancels a tax invoice that was already issued, and GST wants a credit note
 * that points back at it. Outlly refunds in full, so it is one per invoice, for the invoice's whole amount.
 * Like the invoice it copies everything it prints at issue time, so it reads the same years later.
 */
function issuerOf(json: string | null): { name?: string; address?: string; gstin?: string } | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** CN-2026-000001: sequential per year, retried on a rare collision between two refunds at once. */
async function nextNumber(year = new Date().getFullYear()) {
  const prefix = `CN-${year}-`;
  const last = await db.creditNote.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: "desc" }, select: { number: true } });
  const n = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(6, "0");
}

/** Idempotent: the invoice's credit note, issued now if it has none yet. */
export async function issueCreditNote(invoiceId: string, reason: string | null = null) {
  const existing = await db.creditNote.findUnique({ where: { invoiceId } });
  if (existing) return existing;
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  for (let i = 0; i < 4; i++) {
    try {
      return await db.creditNote.create({
        data: {
          number: await nextNumber(),
          invoiceId: inv.id,
          userId: inv.userId,
          customerName: inv.customerName,
          customerEmail: inv.customerEmail,
          description: `Refund of invoice ${inv.number}: ${inv.description}`,
          amountMinor: inv.amountMinor,
          currency: inv.currency,
          reason: reason?.slice(0, 200) || null,
          taxPercent: inv.taxPercent,
          issuer: inv.issuer,
        },
      });
    } catch (e: any) {
      if (e?.code !== "P2002") throw e;
      const again = await db.creditNote.findUnique({ where: { invoiceId } });
      if (again) return again;
    }
  }
  throw new Error("Could not allocate a credit note number");
}

/**
 * Refunds made before credit notes existed (or where issuing failed after the gateway refunded): give each
 * one its credit note. Run by the daily cron; returns how many it issued.
 */
export async function backfillCreditNotes(limit = 50) {
  const missing = await db.invoice.findMany({
    where: { creditNote: null, payment: { status: "refunded" } },
    select: { id: true },
    orderBy: { issuedAt: "asc" },
    take: limit,
  });
  let issued = 0;
  for (const m of missing) {
    try {
      await issueCreditNote(m.id, "Refund issued before credit notes were automatic");
      issued++;
    } catch (e) {
      console.error("[credit-note] backfill", m.id, e);
    }
  }
  return issued;
}

export async function creditNotePdf(creditNoteId: string): Promise<Buffer> {
  const cn = await db.creditNote.findUniqueOrThrow({ where: { id: creditNoteId }, include: { invoice: { select: { number: true, issuedAt: true } } } });
  const biz = issuerOf(cn.issuer) ?? {};
  const taxPercent = cn.taxPercent ?? 0;
  const d = new Pdf();
  const ink: [number, number, number] = [0.07, 0.09, 0.03];
  const mute: [number, number, number] = [0.42, 0.44, 0.39];
  d.rect(0, 836, 198, 6, [0.0, 0.78, 0.36]);
  d.rect(198, 836, 199, 6, [0.42, 0.9, 0.12]);
  d.rect(397, 836, 198, 6, [0.86, 0.96, 0.05]);
  d.jpeg(Buffer.from(INVOICE_LOGO_JPEG.base64, "base64"), INVOICE_LOGO_JPEG, 40, 768, 46, 46);
  d.text(96, 786, "Outlly", 22, true, ink);
  d.text(96, 772, "Create once. Publish everywhere.", 9, false, mute);
  d.textR(555, 796, "CREDIT NOTE", 11, true, [0.62, 0.16, 0.12]);
  d.textR(555, 780, cn.number, 10, false, mute);
  d.line(40, 752, 555, 752);

  d.text(40, 720, "Issued to", 9, true, mute);
  d.text(40, 704, cn.customerName, 12, true, ink);
  d.text(40, 689, cn.customerEmail, 10, false, mute);
  d.text(330, 720, "From", 9, true, mute);
  d.text(330, 704, biz.name || "Outlly", 12, true, ink);
  d.text(330, 689, biz.address || "", 10, false, mute);
  if (biz.gstin) d.text(330, 675, `GSTIN ${biz.gstin}`, 10, false, mute);

  d.text(40, 640, `Issued ${cn.issuedAt.toISOString().slice(0, 10)}`, 10, false, ink);
  d.text(200, 640, `Against invoice ${cn.invoice.number} of ${cn.invoice.issuedAt.toISOString().slice(0, 10)}`, 10, false, mute);
  d.textR(555, 640, "REFUNDED", 11, true, [0.62, 0.16, 0.12]);

  d.rect(40, 596, 515, 26, [0.95, 0.96, 0.93]);
  d.text(52, 605, "Description", 9, true, mute);
  d.textR(543, 605, "Amount", 9, true, mute);
  const tax = Math.round((cn.amountMinor * taxPercent) / (100 + taxPercent));
  d.text(52, 570, cn.description.slice(0, 80), 11, false, ink);
  d.textR(543, 570, `-${formatMoney(cn.amountMinor - tax, cn.currency)}`, 11, false, ink);
  d.line(40, 550, 555, 550);
  if (tax) {
    d.text(330, 530, `Tax (${taxPercent}% incl.)`, 10, false, mute);
    d.textR(543, 530, `-${formatMoney(tax, cn.currency)}`, 10, false, ink);
  }
  d.text(330, 506, "Total credited", 12, true, ink);
  d.textR(543, 506, `-${formatMoney(cn.amountMinor, cn.currency)}`, 14, true, ink);
  if (cn.reason) d.text(40, 470, `Reason: ${cn.reason.slice(0, 90)}`, 9, false, mute);
  d.text(40, 80, "This credit note cancels the invoice above in full.", 10, true, ink);
  d.text(40, 64, "This is a computer-generated document and needs no signature.", 9, false, mute);
  return d.build();
}
