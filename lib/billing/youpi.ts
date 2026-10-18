/**
 * YOUPI PG (github.com/gxurav1710/YouPI-PG): a self-hosted UPI gateway the owner runs on their own server.
 * Pure rules only (no network, no DB) so they can be unit-tested. The HTTP calls live in providers/index.ts.
 *
 * Trust model: a webhook or a return URL is only a HINT. We always ask the gateway for the payment
 * ourselves, server to server, and grant a plan only when the gateway says SUCCESS for OUR order id,
 * the EXACT amount in paise, in INR, at the verification level the admin asked for.
 */
import { blockedHostReason } from "../net/public-host";

export interface YoupiConfig {
  /** Base URL of the checkout portal (it proxies the payment API), e.g. https://pay.example.com */
  gatewayUrl: string;
  /** Public merchant id from the YOUPI admin panel. */
  merchantId: string;
  /** HMAC secret for X-Gateway-Signature. Encrypted at rest. */
  webhookSecret: string;
  /** 1 = one bank SMS / notification seen, 2 = SMS and Gmail both seen. */
  minVerification: 1 | 2;
}

export const YOUPI_DEFAULT: YoupiConfig = { gatewayUrl: "", merchantId: "", webhookSecret: "", minVerification: 1 };

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** A usable gateway URL: https always, plain http only for a local test gateway. Returns "" when unusable. */
export function youpiBase(url: string, mode: "test" | "live"): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "";
  }
  if (u.username || u.password) return "";
  // Live mode: never a private, loopback or metadata host (SSRF). Test mode may use a local gateway.
  if (mode === "live" && blockedHostReason(u.hostname)) return "";
  if (u.protocol === "https:") return u.origin + u.pathname.replace(/\/+$/, "");
  if (u.protocol === "http:" && mode === "test" && LOCAL.test(u.hostname)) return u.origin + u.pathname.replace(/\/+$/, "");
  return "";
}

export function youpiReady(c: YoupiConfig | undefined, mode: "test" | "live") {
  return !!c && !!youpiBase(c.gatewayUrl, mode) && !!c.merchantId.trim() && !!c.webhookSecret;
}

/** Where the buyer may be sent: https (or a local http gateway in test mode). Anything else is refused. */
export function safeCheckoutUrl(url: unknown, mode: "test" | "live"): string | null {
  if (typeof url !== "string" || !url) return null;
  return youpiBase(url, mode) ? new URL(url).toString() : null;
}

export type YoupiStatus = {
  paymentId?: string;
  orderId?: string;
  amountPaise?: string | number;
  currency?: string;
  status?: string;
  verificationLevel?: number;
};

export type YoupiVerdict =
  | { state: "paid" }
  | { state: "pending"; reason?: string }
  | { state: "failed"; reason: string }
  | { state: "mismatch"; reason: string };

/** Decide what a gateway status means for one of our pending payments. */
export function youpiVerdict(s: YoupiStatus, want: { id: string; amountMinor: number; currency: string }, minVerification: 1 | 2): YoupiVerdict {
  if (!s || String(s.orderId ?? "") !== want.id) return { state: "mismatch", reason: "the gateway answered for a different order" };
  const status = String(s.status ?? "").toUpperCase();
  if (status === "FAILED") return { state: "failed", reason: "no matching UPI credit was seen in time" };
  if (status === "EXPIRED") return { state: "failed", reason: "the 5 minute payment window ran out" };
  if (status === "CANCELLED") return { state: "failed", reason: "the buyer cancelled" };
  if (status !== "SUCCESS") return { state: "pending" };
  const paise = Number(s.amountPaise);
  if (!Number.isInteger(paise) || paise !== want.amountMinor) return { state: "mismatch", reason: `paid ${Number.isFinite(paise) ? paise : "?"} paise, expected ${want.amountMinor}` };
  if (String(s.currency ?? "INR").toUpperCase() !== "INR" || want.currency !== "INR") return { state: "mismatch", reason: "currency is not INR" };
  if ((Number(s.verificationLevel) || 0) < minVerification) return { state: "pending", reason: "waiting for the bank alert to be confirmed" };
  return { state: "paid" };
}

/** X-Gateway-Signature: "sha256=<hex>" over the raw body. Returns the hex part, or "" when malformed. */
export function youpiSigHex(header: string | null): string {
  const h = (header ?? "").trim();
  const hex = h.startsWith("sha256=") ? h.slice(7) : h;
  return /^[a-f0-9]{64}$/i.test(hex) ? hex.toLowerCase() : "";
}
