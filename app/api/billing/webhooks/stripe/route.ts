import { type NextRequest } from "next/server";
import { clientIp, json } from "@/lib/http";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/settings";
import { stripe } from "@/lib/billing/providers";
import { completePayment, failPayment, markExternalRefund } from "@/lib/billing/service";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Point Stripe at {APP_URL}/api/billing/webhooks/stripe with checkout.session.completed, checkout.session.expired,
 * charge.refunded and charge.dispute.created (the last two end a Refer & Earn month the payment earned).
 */
export async function POST(req: NextRequest) {
  // Stripe retries anything it doesn't get a 2xx for, so refusing a flood here loses no event.
  if (!rateLimit(`stripe-hook:${clientIp(req)}`, 300, 60_000).ok) return json({ error: "slow down" }, { status: 429 });
  const raw = await req.text();
  if (raw.length > 256_000) return json({ error: "too large" }, { status: 413 });
  const cfg = await getConfig("payments");
  if (!stripe.verifyWebhook(cfg.stripe.webhookSecret, raw, req.headers.get("stripe-signature"))) return json({ error: "bad signature" }, { status: 400 });
  let ev: any;
  try {
    ev = JSON.parse(raw);
  } catch {
    // A signed body that isn't JSON is a 400, never an unhandled 500: a 500 makes Stripe retry the same bad body.
    return json({ error: "bad body" }, { status: 400 });
  }
  const s = ev?.data?.object;
  const named = s?.client_reference_id || s?.metadata?.paymentId;
  // A session naming a payment we don't have (another environment's Stripe account, a deleted account) is
  // received and dropped. Throwing 404 out of completePayment would be a 500, and Stripe would retry it for days.
  const pid = typeof named === "string" && named ? (await db.payment.findUnique({ where: { id: named }, select: { id: true } }))?.id : null;
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
