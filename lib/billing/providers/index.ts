import "server-only";
import { createHmac } from "node:crypto";
import { safeEqual } from "../../crypto";
import type { PaymentConfig } from "../../settings";
import { safeCheckoutUrl, youpiBase, youpiSigHex, type YoupiStatus } from "../youpi";
import { assertPublicUrl } from "../../net/assert-public";

export type CheckoutStart =
  | { kind: "redirect"; url: string; providerRef?: string }
  | { kind: "razorpay"; orderId: string; keyId: string; amount: number; currency: string; name: string; email: string; description: string; providerRef: string };

export interface StartArgs {
  paymentId: string;
  amountMinor: number;
  currency: string;
  planName: string;
  user: { name: string; email: string };
  appUrl: string;
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

// ---------------------------------------------------------------- mock
export const mock = {
  start: async (a: StartArgs): Promise<CheckoutStart> => ({ kind: "redirect", url: `/billing/checkout?p=${encodeURIComponent(a.paymentId)}` }),
};

// ---------------------------------------------------------------- stripe (REST, no SDK)
export const stripe = {
  async start(cfg: PaymentConfig, a: StartArgs): Promise<CheckoutStart> {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.stripe.secretKey}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": a.paymentId },
      body: form({
        mode: "payment",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": a.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(a.amountMinor),
        "line_items[0][price_data][product_data][name]": `Outlly ${a.planName}`,
        customer_email: a.user.email,
        client_reference_id: a.paymentId,
        "metadata[paymentId]": a.paymentId,
        success_url: `${a.appUrl}/billing?checkout=return&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${a.appUrl}/billing?checkout=cancelled`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message ?? `Stripe ${r.status}`);
    return { kind: "redirect", url: j.url, providerRef: j.id };
  },
  async session(cfg: PaymentConfig, id: string) {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${cfg.stripe.secretKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`Stripe ${r.status}`);
    return (await r.json()) as { id: string; payment_status: string; client_reference_id: string; payment_intent: string | null };
  },
  /** Full refund of the payment behind a Checkout Session. */
  async refund(cfg: PaymentConfig, sessionId: string) {
    const ses = await stripe.session(cfg, sessionId);
    if (!ses.payment_intent) throw new Error("Stripe has no charge for this session yet.");
    const r = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.stripe.secretKey}`, "content-type": "application/x-www-form-urlencoded" },
      body: form({ payment_intent: ses.payment_intent }),
      signal: AbortSignal.timeout(15_000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message ?? `Stripe ${r.status}`);
    return j.id as string;
  },
  /** Stripe-Signature: t=..,v1=.. ; HMAC-SHA256(secret, `${t}.${raw}`); 5 min tolerance. */
  verifyWebhook(secret: string, raw: string, header: string | null) {
    if (!header || !secret) return false;
    const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
    const t = Number(parts.t);
    if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
    const want = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
    return header
      .split(",")
      .filter((p) => p.startsWith("v1="))
      .some((p) => safeEqual(p.slice(3), want));
  },
  async test(cfg: PaymentConfig) {
    const k = cfg.stripe.secretKey;
    if (!k) return { ok: false, message: "Add the Stripe secret key first." };
    if (cfg.mode === "live" && k.startsWith("sk_test_")) return { ok: false, message: "Mode is Live but this is a test key (sk_test_)." };
    if (cfg.mode === "test" && k.startsWith("sk_live_")) return { ok: false, message: "Mode is Test but this is a live key (sk_live_). Switch mode or use a test key." };
    const r = await fetch("https://api.stripe.com/v1/balance", { headers: { authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!r) return { ok: false, message: "Could not reach Stripe." };
    if (r.status === 401) return { ok: false, message: "Stripe rejected the secret key." };
    return r.ok ? { ok: true, message: `Connected to Stripe (${k.startsWith("sk_live_") ? "live" : "test"} keys).` } : { ok: false, message: `Stripe answered ${r.status}.` };
  },
};

// ---------------------------------------------------------------- paypal (Orders v2, REST, no SDK)
const ppBase = (cfg: PaymentConfig) => (cfg.mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
const ppTokens = new Map<string, { token: string; until: number }>();
/** Major units as PayPal wants them ("12.99"). Every currency we sell in has 2 decimals. */
export const ppAmount = (minor: number) => (minor / 100).toFixed(2);
const ppError = (j: any, status: number) => j?.details?.[0]?.description ?? j?.message ?? j?.error_description ?? `PayPal ${status}`;

async function ppToken(cfg: PaymentConfig) {
  const key = `${cfg.mode}:${cfg.paypal.clientId}`;
  const hit = ppTokens.get(key);
  if (hit && hit.until > Date.now()) return hit.token;
  const r = await fetch(`${ppBase(cfg)}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: "Basic " + Buffer.from(`${cfg.paypal.clientId}:${cfg.paypal.clientSecret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(ppError(j, r.status));
  ppTokens.set(key, { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 300) - 120) * 1000 });
  return j.access_token as string;
}
async function pp(cfg: PaymentConfig, path: string, init: { method?: string; body?: unknown; requestId?: string } = {}) {
  const r = await fetch(`${ppBase(cfg)}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${await ppToken(cfg)}`, "content-type": "application/json", ...(init.requestId ? { "paypal-request-id": init.requestId } : {}), prefer: "return=representation" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  });
  const j: any = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

export const paypal = {
  /** Creates an order and sends the buyer to PayPal's approve page. They come back to /billing?checkout=paypal&token={orderId}. */
  async start(cfg: PaymentConfig, a: StartArgs): Promise<CheckoutStart> {
    const r = await pp(cfg, "/v2/checkout/orders", {
      method: "POST",
      requestId: `create-${a.paymentId}`,
      body: {
        intent: "CAPTURE",
        purchase_units: [{ reference_id: a.paymentId, custom_id: a.paymentId, description: `Outlly ${a.planName}`.slice(0, 127), amount: { currency_code: a.currency, value: ppAmount(a.amountMinor) } }],
        payment_source: {
          paypal: {
            email_address: a.user.email,
            experience_context: { brand_name: "Outlly", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: `${a.appUrl}/billing?checkout=paypal`, cancel_url: `${a.appUrl}/billing?checkout=cancelled` },
          },
        },
      },
    });
    if (!r.ok) throw new Error(ppError(r.j, r.status));
    const link = (r.j.links ?? []).find((l: any) => l.rel === "payer-action" || l.rel === "approve");
    if (!link) throw new Error("PayPal didn't return an approval link.");
    return { kind: "redirect", url: link.href, providerRef: r.j.id };
  },
  /** Captures an approved order. Safe to repeat: an already captured order reports COMPLETED. */
  async capture(cfg: PaymentConfig, orderId: string): Promise<{ status: "COMPLETED" | "PENDING" | "FAILED"; paymentId: string | null; reason?: string }> {
    const id = encodeURIComponent(orderId);
    let r = await pp(cfg, `/v2/checkout/orders/${id}/capture`, { method: "POST", body: {}, requestId: `capture-${orderId}` });
    if (!r.ok && r.status === 422 && JSON.stringify(r.j).includes("ORDER_ALREADY_CAPTURED")) r = await pp(cfg, `/v2/checkout/orders/${id}`);
    if (!r.ok) return { status: "FAILED", paymentId: null, reason: ppError(r.j, r.status) };
    const unit = r.j.purchase_units?.[0];
    const cap = unit?.payments?.captures?.[0];
    const paymentId = unit?.custom_id ?? unit?.reference_id ?? null;
    if (r.j.status === "COMPLETED" && (!cap || cap.status === "COMPLETED")) return { status: "COMPLETED", paymentId };
    if (cap?.status === "PENDING") return { status: "PENDING", paymentId };
    return { status: "FAILED", paymentId, reason: cap?.status_details?.reason ?? r.j.status };
  },
  /** Full refund of the capture on an order. */
  async refund(cfg: PaymentConfig, orderId: string) {
    const o = await pp(cfg, `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    if (!o.ok) throw new Error(ppError(o.j, o.status));
    const cap = o.j.purchase_units?.[0]?.payments?.captures?.find((c: any) => c.status === "COMPLETED");
    if (!cap) throw new Error("PayPal has no completed capture on this order.");
    const r = await pp(cfg, `/v2/payments/captures/${cap.id}/refund`, { method: "POST", body: {}, requestId: `refund-${orderId}` });
    if (!r.ok) throw new Error(ppError(r.j, r.status));
    return r.j.id as string;
  },
  /** PayPal signs webhooks with a cert; their verify endpoint checks it against the webhook id from the dashboard. */
  async verifyWebhook(cfg: PaymentConfig, raw: string, h: Headers) {
    if (!cfg.paypal.webhookId) return false;
    const need = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
    if (need.some((k) => !h.get(k))) return false;
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      return false;
    }
    const r = await pp(cfg, "/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: {
        auth_algo: h.get("paypal-auth-algo"),
        cert_url: h.get("paypal-cert-url"),
        transmission_id: h.get("paypal-transmission-id"),
        transmission_sig: h.get("paypal-transmission-sig"),
        transmission_time: h.get("paypal-transmission-time"),
        webhook_id: cfg.paypal.webhookId,
        webhook_event: event,
      },
    });
    return r.ok && r.j.verification_status === "SUCCESS";
  },
  async test(cfg: PaymentConfig) {
    const { clientId, clientSecret } = cfg.paypal;
    if (!clientId || !clientSecret) return { ok: false, message: "Add the PayPal client id and secret first." };
    try {
      await ppToken(cfg);
      return { ok: true, message: `Connected to PayPal (${cfg.mode === "live" ? "live" : "sandbox"}).${cfg.paypal.webhookId ? "" : " Add the webhook id so late payments are confirmed too."}` };
    } catch (e) {
      const m = (e as Error).message;
      return { ok: false, message: /client|auth|401/i.test(m) ? `PayPal rejected the client id / secret for ${cfg.mode === "live" ? "live" : "sandbox"}. Check the mode matches the app.` : `PayPal: ${m}` };
    }
  },
};

// ---------------------------------------------------------------- razorpay (REST + Checkout.js)
const basic = (cfg: PaymentConfig) => "Basic " + Buffer.from(`${cfg.razorpay.keyId}:${cfg.razorpay.keySecret}`).toString("base64");
export const razorpay = {
  async start(cfg: PaymentConfig, a: StartArgs): Promise<CheckoutStart> {
    const r = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { authorization: basic(cfg), "content-type": "application/json" },
      body: JSON.stringify({ amount: a.amountMinor, currency: a.currency, receipt: a.paymentId.slice(0, 40), notes: { paymentId: a.paymentId } }),
      signal: AbortSignal.timeout(15_000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.description ?? `Razorpay ${r.status}`);
    return { kind: "razorpay", orderId: j.id, keyId: cfg.razorpay.keyId, amount: a.amountMinor, currency: a.currency, name: a.user.name, email: a.user.email, description: `Outlly ${a.planName}`, providerRef: j.id };
  },
  /** Checkout.js success handler: HMAC-SHA256(keySecret, `${order_id}|${payment_id}`). */
  verifyPayment(cfg: PaymentConfig, orderId: string, paymentId: string, signature: string) {
    const want = createHmac("sha256", cfg.razorpay.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
    return safeEqual(want, signature);
  },
  /** Full refund of the captured payment on an order. */
  async refund(cfg: PaymentConfig, orderId: string) {
    const list = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}/payments`, { headers: { authorization: basic(cfg) }, signal: AbortSignal.timeout(15_000) });
    const lj: any = await list.json().catch(() => ({}));
    if (!list.ok) throw new Error(lj?.error?.description ?? `Razorpay ${list.status}`);
    const paid = (lj.items ?? []).find((x: any) => x.status === "captured");
    if (!paid) throw new Error("Razorpay has no captured payment on this order.");
    const r = await fetch(`https://api.razorpay.com/v1/payments/${paid.id}/refund`, { method: "POST", headers: { authorization: basic(cfg), "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.description ?? `Razorpay ${r.status}`);
    return j.id as string;
  },
  verifyWebhook(secret: string, raw: string, sig: string | null) {
    if (!sig || !secret) return false;
    return safeEqual(createHmac("sha256", secret).update(raw).digest("hex"), sig);
  },
  async test(cfg: PaymentConfig) {
    const { keyId, keySecret } = cfg.razorpay;
    if (!keyId || !keySecret) return { ok: false, message: "Add the Razorpay key id and secret first." };
    if (cfg.mode === "live" && keyId.startsWith("rzp_test_")) return { ok: false, message: "Mode is Live but this is a test key (rzp_test_)." };
    if (cfg.mode === "test" && keyId.startsWith("rzp_live_")) return { ok: false, message: "Mode is Test but this is a live key (rzp_live_)." };
    const r = await fetch("https://api.razorpay.com/v1/payments?count=1", { headers: { authorization: basic(cfg) }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!r) return { ok: false, message: "Could not reach Razorpay." };
    if (r.status === 401) return { ok: false, message: "Razorpay rejected the key id / secret pair." };
    return r.ok ? { ok: true, message: `Connected to Razorpay (${keyId.startsWith("rzp_live_") ? "live" : "test"} keys).` } : { ok: false, message: `Razorpay answered ${r.status}.` };
  },
};

// ---------------------------------------------------------------- youpi (self-hosted UPI gateway, REST)
/**
 * We send only the order id, the amount and a return URL. No name, email or phone: the gateway
 * verifies the buyer itself, so Outlly shares nothing it doesn't have to.
 */
export const youpi = {
  base: (cfg: PaymentConfig) => youpiBase(cfg.youpi.gatewayUrl, cfg.mode),
  async start(cfg: PaymentConfig, a: StartArgs): Promise<CheckoutStart> {
    const base = youpi.base(cfg);
    if (!base) throw new Error("YOUPI gateway URL is not set (https only in live mode).");
    if (a.currency !== "INR") throw new Error("YOUPI takes INR only.");
    if (cfg.mode === "live") await assertPublicUrl(base);
    const r = await fetch(`${base}/api/v1/payments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-merchant-id": cfg.youpi.merchantId, "idempotency-key": a.paymentId },
      body: JSON.stringify({
        orderId: a.paymentId,
        amount: (a.amountMinor / 100).toFixed(2),
        currency: "INR",
        description: `Outlly ${a.planName}`.slice(0, 120),
        returnUrl: `${a.appUrl}/billing?checkout=youpi&p=${encodeURIComponent(a.paymentId)}`,
        metadata: { paymentId: a.paymentId },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 409) throw new Error("A payment for this account is already open on another device.");
    if (!r.ok) throw new Error(String(j?.error ?? `YOUPI ${r.status}`).slice(0, 160));
    if (String(j.orderId ?? "") !== a.paymentId) throw new Error("YOUPI answered for a different order.");
    const url = safeCheckoutUrl(j.checkoutUrl, cfg.mode);
    if (!url || !j.paymentId) throw new Error("YOUPI didn't return a safe checkout link.");
    return { kind: "redirect", url, providerRef: String(j.paymentId).slice(0, 100) };
  },
  /** Server-to-server status read. This, not the webhook body, is what we trust. */
  async status(cfg: PaymentConfig, id: string): Promise<YoupiStatus> {
    const base = youpi.base(cfg);
    if (!base) throw new Error("YOUPI gateway URL is not set.");
    if (cfg.mode === "live") await assertPublicUrl(base);
    const r = await fetch(`${base}/api/v1/payments/${encodeURIComponent(id)}`, {
      headers: { "x-merchant-id": cfg.youpi.merchantId },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`YOUPI ${r.status}`);
    return (await r.json()) as YoupiStatus;
  },
  /** X-Gateway-Signature: sha256=HMAC-SHA256(webhookSecret, raw body), constant-time compare. */
  verifyWebhook(secret: string, raw: string, header: string | null) {
    const got = youpiSigHex(header);
    if (!got || !secret) return false;
    return safeEqual(createHmac("sha256", secret).update(raw).digest("hex"), got);
  },
  async test(cfg: PaymentConfig) {
    const base = youpi.base(cfg);
    if (!base) return { ok: false, message: cfg.mode === "live" ? "Add an https:// gateway URL. Live mode never talks to a gateway over plain http." : "Add the gateway URL (https, or http://localhost for a local test gateway)." };
    if (!cfg.youpi.merchantId) return { ok: false, message: "Add the merchant id from the YOUPI admin panel." };
    if (!cfg.youpi.webhookSecret) return { ok: false, message: "Add the webhook secret, so payments are confirmed even if the buyer closes the tab." };
    if (cfg.mode === "live") {
      const bad = await assertPublicUrl(base).then(() => "", (e: Error) => e.message);
      if (bad) return { ok: false, message: bad };
    }
    const r = await fetch(`${base}/api/v1/payments/outlly-connection-test`, { headers: { "x-merchant-id": cfg.youpi.merchantId }, redirect: "error", signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!r) return { ok: false, message: `Could not reach the gateway at ${base}.` };
    // An unknown id must come back 404: that proves the payment API is answering.
    return r.status === 404 || r.ok ? { ok: true, message: `Gateway is answering at ${base}. Do one real Rs 1 test payment before going live.` } : { ok: false, message: `The gateway answered ${r.status}.` };
  },
};
