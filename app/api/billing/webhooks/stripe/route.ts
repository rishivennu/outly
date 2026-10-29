import { type NextRequest } from "next/server";
import { json } from "@/lib/http";
import { getConfig } from "@/lib/settings";
import { stripe } from "@/lib/billing/providers";
import { completePayment, failPayment, markExternalRefund } from "@/lib/billing/service";

/**
 * Point Stripe at {APP_URL}/api/billing/webhooks/stripe with checkout.session.completed, checkout.session.expired,
 * charge.refunded and charge.dispute.created (the last two end a Refer & Earn month the payment earned).
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const cfg = await getConfig("payments");
  if (!stripe.verifyWebhook(cfg.stripe.webhookSecret, raw, req.headers.get("stripe-signature"))) return json({ error: "bad signature" }, { status: 400 });
  const ev = JSON.parse(raw);
  const s = ev?.data?.object;
  const pid = s?.client_reference_id || s?.metadata?.paymentId;
  try {
    if (pid && ev.type === "checkout.session.completed" && s.payment_status === "paid") await completePayment(pid);
    if (pid && ev.type === "checkout.session.expired") await failPayment(pid, "Checkout expired before payment");
    if ((ev.type === "charge.refunded" && s?.refunded) || ev.type === "charge.dispute.created") {
      // Charges carry the PaymentIntent (its metadata names the payment on sessions made since 1052).
      const id = s?.metadata?.paymentId || (typeof s?.payment_intent === "string" ? await stripe.paymentIdForIntent(cfg, s.payment_intent) : null);
      if (id) await markExternalRefund(id, ev.type === "charge.refunded" ? "refund" : "chargeback", s?.id ?? "");
    }
  } catch (e) {
    console.error("[stripe webhook]", e);
    return json({ error: "retry" }, { status: 500 }); // Stripe retries with backoff
  }
  return json({ received: true });
}
