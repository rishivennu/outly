import { type NextRequest } from "next/server";
import { json } from "@/lib/http";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/settings";
import { paypal } from "@/lib/billing/providers";
import { capturePaypal, completePayment, failPayment, markExternalRefund } from "@/lib/billing/service";

export const dynamic = "force-dynamic";

/**
 * Point PayPal at {APP_URL}/api/billing/webhooks/paypal with CHECKOUT.ORDER.APPROVED,
 * PAYMENT.CAPTURE.COMPLETED and PAYMENT.CAPTURE.DENIED. Covers buyers who close the tab before returning.
 * Add PAYMENT.CAPTURE.REFUNDED, PAYMENT.CAPTURE.REVERSED and CUSTOMER.DISPUTE.CREATED so a refund made at
 * PayPal or a chargeback ends the Refer & Earn month that payment earned.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const cfg = await getConfig("payments");
  if (!(await paypal.verifyWebhook(cfg, raw, req.headers).catch(() => false))) return json({ error: "bad signature" }, { status: 400 });
  const ev = JSON.parse(raw);
  const r = ev?.resource ?? {};
  try {
    if (ev.event_type === "CHECKOUT.ORDER.APPROVED" && r.id) await capturePaypal(r.id, null);
    if (ev.event_type === "PAYMENT.CAPTURE.COMPLETED" || ev.event_type === "PAYMENT.CAPTURE.DENIED") {
      const orderId = r.supplementary_data?.related_ids?.order_id;
      const p = await db.payment.findFirst({ where: { provider: "paypal", OR: [...(orderId ? [{ providerRef: orderId }] : []), ...(r.custom_id ? [{ id: r.custom_id }] : [])] } });
      if (p && ev.event_type === "PAYMENT.CAPTURE.COMPLETED") await completePayment(p.id);
      if (p && ev.event_type === "PAYMENT.CAPTURE.DENIED") await failPayment(p.id, "PayPal denied the payment");
    }
    if (ev.event_type === "PAYMENT.CAPTURE.REFUNDED" || ev.event_type === "PAYMENT.CAPTURE.REVERSED" || ev.event_type === "CUSTOMER.DISPUTE.CREATED") {
      const dispute = ev.event_type === "CUSTOMER.DISPUTE.CREATED";
      // Refund resources link "up" to their capture; disputes name it as seller_transaction_id.
      const tx = dispute ? r.disputed_transactions?.[0] : null;
      const captureId: string | undefined = dispute
        ? tx?.seller_transaction_id
        : (r.links ?? []).find((l: { rel?: string; href?: string }) => l.rel === "up")?.href?.split("/captures/")[1]?.split(/[/?]/)[0];
      let paymentId: string | null = (dispute ? tx?.custom : r.custom_id) ?? null;
      let orderId: string | null = null;
      if (!paymentId && captureId) ({ paymentId, orderId } = await paypal.captureRef(cfg, captureId));
      const p = paymentId || orderId ? await db.payment.findFirst({ where: { provider: "paypal", OR: [...(paymentId ? [{ id: paymentId }] : []), ...(orderId ? [{ providerRef: orderId }] : [])] } }) : null;
      // A partial refund (money still captured) changes nothing here. The refund resource carries the running
      // total refunded on its capture; without it, this refund's own amount.
      const refunded = r.seller_payable_breakdown?.total_refunded_amount?.value ?? r.amount?.value;
      const partial = ev.event_type === "PAYMENT.CAPTURE.REFUNDED" && !!p && refunded != null && Math.round(Number(refunded) * 100) < p.amountMinor;
      if (p && !partial) await markExternalRefund(p.id, ev.event_type === "PAYMENT.CAPTURE.REFUNDED" ? "refund" : "chargeback", r.id ?? r.dispute_id ?? "");
    }
  } catch (e) {
    console.error("[paypal webhook]", e);
    return json({ error: "retry" }, { status: 500 }); // PayPal retries for up to 3 days
  }
  return json({ received: true });
}
