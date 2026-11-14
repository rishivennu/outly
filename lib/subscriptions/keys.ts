import "server-only";
import { createHmac } from "node:crypto";
import { db } from "../db";
import { env } from "../env";
import { inboxKey } from "../founding-config";

/**
 * 1147 offer ledger keys: one-way hashes of who someone is (inbox, verified phone, device id, payment method),
 * so a trial or first-time price is used once per person. Only the HMAC is ever stored.
 */
export type LedgerKind = "email" | "phone" | "device" | "payment";
export type LedgerKey = { kind: LedgerKind; keyHash: string };

const pepper = () => process.env.OFFER_PEPPER || env.AUTH_SECRET;

/** One inbox per person: lowercase; Gmail/Googlemail dots and +tags folded (the founding seat normaliser). */
export const normaliseEmail = (raw: string) => inboxKey(raw);

export function normaliseKey(kind: LedgerKind, raw: string) {
  const v = raw.trim();
  if (kind === "email") return normaliseEmail(v);
  if (kind === "phone") return v.replace(/[^\d+]/g, "");
  return v.toLowerCase();
}

export const hashKey = (kind: LedgerKind, raw: string) => createHmac("sha256", pepper()).update(`ledger:${kind}:${normaliseKey(kind, raw)}`).digest("base64url");

/** The person's keys: their inbox, their phone once WhatsApp proved it, plus a device id / payment key when known. */
export async function ledgerKeysForUser(userId: string, extra: { deviceId?: string | null; paymentKey?: string | null } = {}): Promise<LedgerKey[]> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, phone: true, phoneVerifiedAt: true } });
  const keys: LedgerKey[] = [];
  if (u?.email) keys.push({ kind: "email", keyHash: hashKey("email", u.email) });
  if (u?.phone && u.phoneVerifiedAt) keys.push({ kind: "phone", keyHash: hashKey("phone", u.phone) });
  if (extra.deviceId) keys.push({ kind: "device", keyHash: hashKey("device", extra.deviceId) });
  if (extra.paymentKey) keys.push({ kind: "payment", keyHash: hashKey("payment", extra.paymentKey) });
  return keys;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : "");

/**
 * The raw payment-method key from a Razorpay payment entity (webhook body, already signature-checked):
 * UPI = the VPA; a card = its token / fingerprint when Razorpay sends one, else network + last4 + issuer + expiry.
 */
export function paymentKeyFromRazorpay(entity: unknown): string | null {
  const p = (entity && typeof entity === "object" ? entity : {}) as Record<string, any>;
  const vpa = str(p.vpa) || str(p.upi?.vpa);
  if (vpa) return `upi:${vpa}`;
  const card = (p.card && typeof p.card === "object" ? p.card : null) as Record<string, unknown> | null;
  const fp = str(card?.fingerprint) || str(p.token_id) || str(card?.token_iin);
  if (fp) return `cardtok:${fp}`;
  if (card && str(card.last4)) {
    const exp = [card.expiry_month, card.expiry_year].filter((x) => x !== undefined && x !== null && x !== "").join("/");
    return `card:${str(card.network)}:${str(card.last4)}:${str(card.issuer)}:${exp}`;
  }
  return null;
}

/** Stripe: the card fingerprint, from a charge or a PaymentMethod object. */
export function paymentKeyFromStripe(obj: unknown): string | null {
  const o = (obj && typeof obj === "object" ? obj : {}) as Record<string, any>;
  const fp = str(o.payment_method_details?.card?.fingerprint) || str(o.card?.fingerprint);
  return fp ? `stripe:${fp}` : null;
}
