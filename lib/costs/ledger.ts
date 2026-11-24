import "server-only";
import { db } from "../db";
import { getEconomics } from "../subscriptions/policy";
import type { CostCategory } from "../subscriptions/economics";
import { costMinor } from "../subscriptions/economics";
import { dayKey, providerOf, toInrMinor, type CostCategoryId, type CostSource } from "./core";
import { priceFor } from "./prices";

/**
 * R1314 write path. One function books a cost; it records the original currency and the FX used (from the
 * economics policy, the same table checkout uses) and bumps the daily rollup in the same transaction. `ref`
 * makes a write idempotent. Never throws: metering must not break the feature that caused it.
 */
export interface CostInput {
  provider: string;
  category: CostCategoryId;
  feature?: string;
  userId?: string | null;
  model?: string;
  units?: number;
  unit?: string;
  unitPriceId?: string | null;
  amountMinor: number;
  currency?: string;
  source?: CostSource;
  ref?: string;
  note?: string;
  meta?: Record<string, unknown>;
  at?: Date;
}

export async function fxToInr(currency: string) {
  if (currency === "INR") return 1;
  const econ = await getEconomics();
  return econ.fx[currency] ?? 0;
}

export async function recordCostEvent(o: CostInput) {
  try {
    const at = o.at ?? new Date();
    const currency = o.currency ?? "INR";
    const fx = await fxToInr(currency);
    const inrMinor = toInrMinor(o.amountMinor, fx);
    if (o.amountMinor === 0) return null;
    const feature = o.feature ?? "";
    const source = o.source ?? "estimate";
    const row = await db.$transaction(async (tx) => {
      if (o.ref && (await tx.costEvent.findUnique({ where: { ref: o.ref }, select: { id: true } }))) return null;
      const ev = await tx.costEvent.create({
        data: {
          at, day: dayKey(at), provider: o.provider, category: o.category, feature, userId: o.userId ?? null, model: o.model ?? "", units: o.units ?? 0, unit: o.unit ?? "",
          unitPriceId: o.unitPriceId ?? null, amountMinor: o.amountMinor, currency, fxToInr: fx, inrMinor, source, ref: o.ref ?? null, note: o.note ?? "", meta: JSON.stringify(o.meta ?? {}),
        },
      });
      const key = { day: ev.day, provider: o.provider, category: o.category, feature, source };
      await tx.costDaily.upsert({ where: { day_provider_category_feature_source: key }, create: { ...key, units: ev.units, inrMinor, count: 1 }, update: { units: { increment: ev.units }, inrMinor: { increment: inrMinor }, count: { increment: 1 } } });
      return ev;
    });
    return row;
  } catch (e) {
    console.error("[costs] ledger", o.provider, o.category, e);
    return null;
  }
}

/** Prices `units` of a provider SKU at the unit price in force and books it as an estimate (or `reported` when the provider gave the usage). */
export async function recordUsage(o: Omit<CostInput, "amountMinor" | "currency" | "unitPriceId" | "category"> & { sku: string; units: number; category?: CostCategoryId }) {
  const price = await priceFor(o.provider, o.sku, o.at ?? new Date()).catch(() => null);
  if (!price) {
    console.warn("[costs] no unit price for", o.provider, o.sku);
    return null;
  }
  const amountMinor = Math.round(price.price * o.units * 100);
  return recordCostEvent({ ...o, category: o.category ?? providerOf(o.provider).category, unit: o.unit ?? price.unit, unitPriceId: price.id, amountMinor, currency: price.currency, source: o.source ?? "estimate", meta: { ...(o.meta ?? {}), sku: o.sku, unitPrice: price.price } });
}

/** 1147 cost categories to ledger provider / category / feature (the bridge from the economics model to the ledger). */
export const ECON_MAP: Record<CostCategory, { provider: string; category: CostCategoryId; feature: string; unit: string }> = {
  ai: { provider: "gemini", category: "ai", feature: "writing", unit: "request" },
  ai_reply: { provider: "gemini", category: "ai", feature: "inbox-reply", unit: "request" },
  ai_assist: { provider: "gemini", category: "ai", feature: "assist", unit: "request" },
  transcription: { provider: "gemini", category: "transcription", feature: "captions", unit: "minute" },
  x_post: { provider: "x", category: "x", feature: "x-post", unit: "post" },
  x_read: { provider: "x", category: "x", feature: "x-read", unit: "read" },
  storage: { provider: "supabase", category: "storage", feature: "storage", unit: "gb-month" },
  egress: { provider: "supabase", category: "egress", feature: "egress", unit: "gb" },
};

/** Books a 1147 metered use at the economics rate (INR) as an estimate. Runs whether or not the 1147 policy is on. */
export async function recordEconomicsUse(o: { userId: string; category: CostCategory; units: number; now?: Date }) {
  try {
    const econ = await getEconomics();
    const inr = costMinor(o.category, o.units, econ);
    if (inr <= 0) return null;
    const m = ECON_MAP[o.category];
    return recordCostEvent({ provider: m.provider, category: m.category, feature: m.feature, userId: o.userId, units: o.units, unit: m.unit, amountMinor: inr, currency: "INR", source: "estimate", at: o.now, meta: { econ: o.category, rate: econ.rates[o.category] } });
  } catch (e) {
    console.error("[costs] economics use", o.category, e);
    return null;
  }
}

/** The first day anything was booked; the dashboard says "tracking since" instead of pretending older months exist. */
export async function trackingSince() {
  const first = await db.costDaily.findFirst({ orderBy: { day: "asc" }, select: { day: true } });
  return first?.day ?? null;
}
