import "server-only";
import { db } from "../db";
import { env } from "../env";
import { Pdf } from "./pdf";
import { INVOICE_LOGO_JPEG } from "./logo";
import { formatMoney } from "./money";
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

/** OUT-2026-000042. Sequential per year; retried on the rare unique collision between two parallel payments. */
async function nextNumber() {
  const y = new Date().getFullYear();
  const prefix = `OUT-${y}-`;
  const last = await db.invoice.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: "desc" }, select: { number: true } });
  const n = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(6, "0");
}

/** Idempotent: one invoice per successful payment, however many times a webhook fires. */
export async function issueInvoice(paymentId: string, opts: { email?: boolean } = { email: true }) {
  const existing = await db.invoice.findUnique({ where: { paymentId } });
  if (existing) return existing;
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { user: true, subscription: { include: { plan: true } } } });
  if (p.status !== "succeeded") throw new Error("Invoices are only issued for successful payments");
  const description = p.subscription ? `${p.subscription.plan.name} plan, 1 ${p.subscription.interval}` : "Outlly subscription";
  // Copy what the PDF prints onto the invoice itself: it must read the same years later, after a
  // change of business details or tax rate, and after the customer deletes their account.
  const biz = (await getConfig("payments")).business;
  const snapshot = {
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
  if (opts.email !== false && !p.sample) {
    const pdf = await invoicePdf(inv.id);
    const r = await sendEmail({
      to: inv.customerEmail,
      subject: `Your Outlly invoice ${inv.number}`,
      kind: "invoice",
      html: templates.invoice({ name: inv.customerName, number: inv.number, amount: formatMoney(inv.amountMinor, inv.currency), plan: description, url: `${env.APP_URL}/billing` }),
      attachments: [{ filename: `${inv.number}.pdf`, content: pdf }],
    });
    if (r.ok) await db.invoice.update({ where: { id: inv.id }, data: { emailedAt: new Date() } });
  }
  return inv;
}

export async function invoicePdf(invoiceId: string): Promise<Buffer> {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payment: true } });
  // Invoices issued before the snapshot columns existed fall back to today's settings and the payment row.
  const live = (await getConfig("payments")).business;
  const kept = issuerOf(inv.issuer);
  const biz = { name: kept?.name ?? live.name, address: kept?.address ?? live.address, gstin: kept?.gstin ?? live.gstin, taxPercent: inv.taxPercent ?? live.taxPercent };
  const provider = inv.provider ?? inv.payment?.provider ?? "";
  const providerRef = inv.providerRef ?? inv.payment?.providerRef ?? "";
  const d = new Pdf();
  const ink: [number, number, number] = [0.07, 0.09, 0.03];
  const mute: [number, number, number] = [0.42, 0.44, 0.39];
  // Light, print-friendly header: brand gradient strip, the Outlly rocket tile, wordmark, invoice number.
  d.rect(0, 836, 198, 6, [0.0, 0.78, 0.36]);
  d.rect(198, 836, 199, 6, [0.42, 0.9, 0.12]);
  d.rect(397, 836, 198, 6, [0.86, 0.96, 0.05]);
  d.jpeg(Buffer.from(INVOICE_LOGO_JPEG.base64, "base64"), INVOICE_LOGO_JPEG, 40, 768, 46, 46);
  d.text(96, 786, "Outlly", 22, true, ink);
  d.text(96, 772, "Create once. Publish everywhere.", 9, false, mute);
  d.textR(555, 796, "TAX INVOICE", 11, true, [0.13, 0.45, 0.05]);
  d.textR(555, 780, inv.number, 10, false, mute);
  d.line(40, 752, 555, 752);

  d.text(40, 720, "Billed to", 9, true, mute);
  d.text(40, 704, inv.customerName, 12, true, ink);
  d.text(40, 689, inv.customerEmail, 10, false, mute);
  d.text(330, 720, "From", 9, true, mute);
  d.text(330, 704, biz.name || "Outlly", 12, true, ink);
  d.text(330, 689, biz.address || "", 10, false, mute);
  if (biz.gstin) d.text(330, 675, `GSTIN ${biz.gstin}`, 10, false, mute);

  const issued = inv.issuedAt.toISOString().slice(0, 10);
  d.text(40, 640, `Issued ${issued}`, 10, false, ink);
  d.text(200, 640, `Payment ${provider.toUpperCase()} ${providerRef.slice(0, 22)}`.trim(), 10, false, mute);
  d.textR(555, 640, "PAID", 11, true, [0.07, 0.53, 0.24]);

  d.rect(40, 596, 515, 26, [0.95, 0.96, 0.93]);
  d.text(52, 605, "Description", 9, true, mute);
  d.textR(543, 605, "Amount", 9, true, mute);
  const tax = Math.round((inv.amountMinor * (biz.taxPercent || 0)) / (100 + (biz.taxPercent || 0)));
  d.text(52, 570, inv.description, 11, false, ink);
  d.textR(543, 570, formatMoney(inv.amountMinor - tax, inv.currency), 11, false, ink);
  d.line(40, 550, 555, 550);
  if (tax) {
    d.text(330, 530, `Tax (${biz.taxPercent}% incl.)`, 10, false, mute);
    d.textR(543, 530, formatMoney(tax, inv.currency), 10, false, ink);
  }
  d.text(330, 506, "Total paid", 12, true, ink);
  d.textR(543, 506, formatMoney(inv.amountMinor, inv.currency), 14, true, ink);
  d.text(40, 80, "Thank you for creating with Outlly.", 10, true, ink);
  d.text(40, 64, "This is a computer-generated invoice and needs no signature.", 9, false, mute);
  return d.build();
}
