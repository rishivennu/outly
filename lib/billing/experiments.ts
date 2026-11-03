import "server-only";
import { db } from "../db";
import { getConfig } from "../settings";
import { experimentResults, normalizeExperiments, priceVariant, type VariantCounts } from "./experiments-core";

/** The live price-test config, cleaned. */
export const experimentsConfig = async () => normalizeExperiments(await getConfig("experiments"));

/** One step per person per test; repeats are ignored (the unique key decides). Never throws. */
export async function recordExperiment(e: { experiment: string; variant: string; userId: string; kind: "exposure" | "checkout" | "paid"; amountMinor?: number; currency?: string }) {
  await db.experimentEvent
    .create({ data: { experiment: e.experiment, variant: e.variant, userId: e.userId, kind: e.kind, amountMinor: e.amountMinor ?? 0, currency: e.currency ?? "" } })
    .catch((err) => {
      if ((err as { code?: string })?.code !== "P2002") console.error("[experiment]", err);
    });
}

/**
 * This person's test price for `planSlug` in `currency`, recording that they saw it. Null = not in a test
 * (test off, other plan, other currency), so the normal price shows.
 */
export async function experimentPrice(userId: string, planSlug: string, currency: string, opts: { expose?: boolean } = {}) {
  const v = priceVariant(await experimentsConfig(), planSlug, userId, currency);
  if (v && opts.expose !== false) await recordExperiment({ experiment: v.experiment, variant: v.variant, userId, kind: "exposure", currency });
  return v;
}

/** `payment.variant` is stored as "<experiment>:<variant>". */
export const variantTag = (v: { experiment: string; variant: string }) => `${v.experiment}:${v.variant}`.slice(0, 120);
export function parseVariantTag(tag: string | null | undefined) {
  if (!tag) return null;
  const at = tag.lastIndexOf(":");
  return at > 0 ? { experiment: tag.slice(0, at), variant: tag.slice(at + 1) } : null;
}

/** Results for the admin: exposures, checkouts, paid and revenue per variant, in the config's variant order. */
export async function experimentReport(name?: string) {
  const cfg = await experimentsConfig();
  const experiment = name || cfg.price.name;
  const rows = await db.experimentEvent.groupBy({ by: ["variant", "kind"], where: { experiment }, _count: true, _sum: { amountMinor: true } });
  const ids = [...new Set([...(experiment === cfg.price.name ? cfg.price.variants.map((v) => v.id) : []), ...rows.map((r) => r.variant)])];
  const counts: VariantCounts[] = ids.map((variant) => {
    const of = (kind: string) => rows.find((r) => r.variant === variant && r.kind === kind);
    return { variant, exposures: of("exposure")?._count ?? 0, checkouts: of("checkout")?._count ?? 0, paid: of("paid")?._count ?? 0, revenueMinor: of("paid")?._sum.amountMinor ?? 0 };
  });
  return { experiment, config: cfg.price, variants: experimentResults(counts) };
}
