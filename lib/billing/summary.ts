import "server-only";
import { db } from "@/lib/db";
import type { BillingSummary } from "@/components/settings/BillingCards";
import { activeGateway } from "@/lib/billing/service";
import { accessFor } from "@/lib/billing/access";
import { isPaidSub } from "@/lib/billing/access-core";

export type { BillingSummary };

/** Settings > Billing & Subscription, as app/(studio)/settings/page.tsx reads it server-side (R1301: shared with GET /api/settings/billing). */
export async function billingSummary(userId: string, name: string, email: string): Promise<BillingSummary> {
  const [subs, payments, invoices, gw, access] = await Promise.all([
    db.subscription.findMany({ where: { userId, status: "active" }, include: { plan: true }, orderBy: { createdAt: "desc" } }),
    db.payment.findMany({ where: { userId, sample: false }, orderBy: { createdAt: "desc" }, take: 12, include: { invoice: { select: { number: true } } } }),
    db.invoice.findMany({ where: { userId }, orderBy: { issuedAt: "desc" }, take: 8, include: { payment: { select: { status: true } }, creditNote: { select: { number: true } } } }),
    activeGateway(),
    accessFor(userId),
  ]);
  const sub = subs.find((s) => isPaidSub(s)) ?? subs[0] ?? null;
  const best = access.best;
  return {
    name,
    email,
    gateway: gw.provider,
    inForce: best?.plan.name ?? "Free",
    plan: sub
      ? { name: sub.plan.name, priceMinor: sub.priceMinor, currency: sub.currency, interval: sub.interval, periodEnd: sub.currentPeriodEnd.toISOString(), cancelAtPeriodEnd: sub.cancelAtPeriodEnd, pausedUntil: sub.pausedUntil && sub.pausedUntil > new Date() ? sub.pausedUntil.toISOString() : null, provider: sub.provider }
      : null,
    extra: best && (best.source === "admin" || best.source === "referral") && best.endsAt ? { planName: best.plan.name, source: best.source, endsAt: best.endsAt.toISOString() } : null,
    payments: payments.map((p) => ({ id: p.id, amountMinor: p.amountMinor, currency: p.currency, provider: p.provider, status: p.status, interval: p.interval, at: p.createdAt.toISOString(), reason: p.failureReason, invoice: p.invoice?.number ?? null })),
    invoices: invoices.map((i) => ({ number: i.number, description: i.description, amountMinor: i.amountMinor, currency: i.currency, issuedAt: i.issuedAt.toISOString(), refunded: i.payment?.status === "refunded", creditNote: i.creditNote?.number ?? null })),
  };
}
