import "server-only";
import { db } from "../db";

/**
 * R1314 unit prices with history. The seeds below are the public list prices at the time they were written
 * (source "seed"); an admin confirms or overrides them in Admin > Infrastructure & Costs > Unit prices, which adds a
 * new row with its own effectiveFrom. The ledger stores which row priced each event, so changing a price never
 * rewrites what was already booked.
 */
export interface SeedPrice { provider: string; sku: string; unit: string; price: number; currency: string; effectiveFrom: string; sourceUrl: string; note: string }
export const SEED_PRICES: readonly SeedPrice[] = [
  { provider: "gemini", sku: "gemini-2.5-flash:input", unit: "token", price: 0.30 / 1e6, currency: "USD", effectiveFrom: "2025-06-17", sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing", note: "Paid tier, text/image/video input, per token." },
  { provider: "gemini", sku: "gemini-2.5-flash:output", unit: "token", price: 2.50 / 1e6, currency: "USD", effectiveFrom: "2025-06-17", sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing", note: "Paid tier, output incl. thinking tokens." },
  { provider: "gemini", sku: "gemini-2.5-flash:audio-input", unit: "token", price: 1.00 / 1e6, currency: "USD", effectiveFrom: "2025-06-17", sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing", note: "Audio input per token." },
  { provider: "gemini", sku: "gemini-2.5-flash-lite:input", unit: "token", price: 0.10 / 1e6, currency: "USD", effectiveFrom: "2025-07-22", sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing", note: "" },
  { provider: "gemini", sku: "gemini-2.5-flash-lite:output", unit: "token", price: 0.40 / 1e6, currency: "USD", effectiveFrom: "2025-07-22", sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing", note: "" },
  { provider: "gemini", sku: "gemini-2.5-pro:input", unit: "token", price: 1.25 / 1e6, currency: "USD", effectiveFrom: "2025-06-17", sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing", note: "Prompts up to 200k tokens." },
  { provider: "gemini", sku: "gemini-2.5-pro:output", unit: "token", price: 10.00 / 1e6, currency: "USD", effectiveFrom: "2025-06-17", sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing", note: "Prompts up to 200k tokens." },
  { provider: "gemini", sku: "gemini-2.0-flash:input", unit: "token", price: 0.10 / 1e6, currency: "USD", effectiveFrom: "2025-02-05", sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing", note: "" },
  { provider: "gemini", sku: "gemini-2.0-flash:output", unit: "token", price: 0.40 / 1e6, currency: "USD", effectiveFrom: "2025-02-05", sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing", note: "" },
  { provider: "resend", sku: "resend:email", unit: "email", price: 20 / 50000, currency: "USD", effectiveFrom: "2025-01-01", sourceUrl: "https://resend.com/pricing", note: "Pro plan $20 for 50k emails, spread per email. Free tier covers 3k/month." },
  { provider: "vercel", sku: "vercel:bandwidth-gb", unit: "gb", price: 0.15, currency: "USD", effectiveFrom: "2025-01-01", sourceUrl: "https://vercel.com/pricing", note: "Fast Data Transfer beyond the plan's included 1 TB." },
  { provider: "render", sku: "render:bandwidth-gb", unit: "gb", price: 0.15, currency: "USD", effectiveFrom: "2025-01-01", sourceUrl: "https://render.com/pricing", note: "Beyond 5 GB included on Hobby." },
  { provider: "render", sku: "render:custom-domain", unit: "domain-month", price: 0.25, currency: "USD", effectiveFrom: "2025-01-01", sourceUrl: "https://render.com/pricing", note: "Beyond 2 included custom domains." },
  { provider: "supabase", sku: "supabase:storage-gb-month", unit: "gb-month", price: 0.021, currency: "USD", effectiveFrom: "2025-01-01", sourceUrl: "https://supabase.com/pricing", note: "File storage beyond the plan's included GB." },
  { provider: "supabase", sku: "supabase:egress-gb", unit: "gb", price: 0.09, currency: "USD", effectiveFrom: "2025-01-01", sourceUrl: "https://supabase.com/pricing", note: "Egress beyond included." },
];

let seeded: Promise<void> | null = null;
/** Writes the seeds once per database (skips any provider+sku that already has a row). Safe to call often. */
export function ensureSeedPrices() {
  seeded ??= (async () => {
    const have = new Set((await db.unitPrice.findMany({ select: { provider: true, sku: true }, distinct: ["provider", "sku"] })).map((r) => `${r.provider}/${r.sku}`));
    const missing = SEED_PRICES.filter((s) => !have.has(`${s.provider}/${s.sku}`));
    if (missing.length) await db.unitPrice.createMany({ data: missing.map((s) => ({ provider: s.provider, sku: s.sku, unit: s.unit, price: s.price, currency: s.currency, effectiveFrom: new Date(`${s.effectiveFrom}T00:00:00Z`), source: "seed", sourceUrl: s.sourceUrl, note: s.note, createdBy: "seed" })) });
  })().catch((e) => {
    seeded = null;
    console.error("[costs] seed prices", e);
  });
  return seeded;
}

export type UnitPriceRow = Awaited<ReturnType<typeof db.unitPrice.findMany>>[number];

/** The price in force for a SKU at `at`: latest effectiveFrom <= at (and not ended), else null. */
export async function priceFor(provider: string, sku: string, at = new Date()): Promise<UnitPriceRow | null> {
  await ensureSeedPrices();
  return db.unitPrice.findFirst({ where: { provider, sku, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }, orderBy: { effectiveFrom: "desc" } });
}

export async function listPrices() {
  await ensureSeedPrices();
  return db.unitPrice.findMany({ orderBy: [{ provider: "asc" }, { sku: "asc" }, { effectiveFrom: "desc" }] });
}

/** A manual override: closes the current row at `effectiveFrom` and adds the new one. */
export async function addPrice(o: { provider: string; sku: string; unit: string; price: number; currency: string; effectiveFrom: Date; note?: string; sourceUrl?: string; by: string }) {
  await ensureSeedPrices();
  return db.$transaction(async (tx) => {
    await tx.unitPrice.updateMany({ where: { provider: o.provider, sku: o.sku, effectiveTo: null, effectiveFrom: { lt: o.effectiveFrom } }, data: { effectiveTo: o.effectiveFrom } });
    return tx.unitPrice.create({ data: { provider: o.provider, sku: o.sku, unit: o.unit, price: o.price, currency: o.currency, effectiveFrom: o.effectiveFrom, source: "manual", sourceUrl: o.sourceUrl ?? "", note: o.note ?? "", createdBy: o.by } });
  });
}
