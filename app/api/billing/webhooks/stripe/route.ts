import { type NextRequest } from "next/server";
import { json } from "@/lib/http";
import { getConfig } from "@/lib/settings";
import { stripe } from "@/lib/billing/providers";
import { completePayment, failPayment } from "@/lib/billing/service";

/** Point Stripe at {APP_URL}/api/billing/webhooks/stripe (checkout.session.completed, checkout.session.expired). */
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
  } catch (e) {
    console.error("[stripe webhook]", e);
    return json({ error: "retry" }, { status: 500 }); // Stripe retries with backoff
  }
  return json({ received: true });
}
