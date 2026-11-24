import "server-only";
import { recordCostEvent } from "./ledger";
import { priceFor } from "./prices";
import { raiseAlert } from "./manual";

/**
 * R1315 token-level AI metering. Every model call reports its token usage (Gemini usageMetadata, OpenAI-shaped
 * `usage`); this books input and output at the unit price on file for `<model>:input` / `<model>:output`. A model
 * with no price on file is still booked (units, amount 0, meta.unpriced) and raises one alert asking for a price,
 * so the gap is visible instead of silently zero.
 */
export const LEDGER_PROVIDER: Record<string, string> = { gemini: "gemini", nvidia: "nvidia", kimi: "openrouter" };
/** Price SKUs are keyed by the bare model id: "moonshotai/kimi-k2.6" and "kimi-k2.6" are one SKU. */
export const skuModel = (model: string) => model.replace(/^.*\//, "").toLowerCase();

/** Ledger unit per side, so the AI view can group tokens in/out straight from the rollup without reading meta. */
export const TOKEN_UNIT = { input: "token-in", output: "token-out" } as const;

export interface TokenUse { provider: string; model: string; input: number; output: number; feature: string; userId?: string | null; at?: Date }

export async function recordTokens(u: TokenUse) {
  try {
    const provider = LEDGER_PROVIDER[u.provider] ?? u.provider;
    const model = skuModel(u.model);
    const at = u.at ?? new Date();
    const out = [];
    for (const side of ["input", "output"] as const) {
      const units = Math.max(0, Math.round(u[side]));
      if (!units) continue;
      const price = await priceFor(provider, `${model}:${side}`, at).catch(() => null);
      if (!price) {
        await raiseAlert({ key: `price-missing:${provider}:${model}`, kind: "sync", severity: "info", title: `No unit price for ${provider} ${model}`, body: `Tokens are being counted but booked at ₹0 until a price for ${model}:input and ${model}:output is added under Unit prices.` });
        out.push(await recordCostEvent({ provider, category: "ai", feature: u.feature, userId: u.userId ?? null, model, units, unit: TOKEN_UNIT[side], amountMinor: 0, currency: "USD", source: "reported", at, meta: { side, unpriced: true }, note: `${side} tokens, no price on file` }));
        continue;
      }
      // Fractions of a paisa add up over thousands of calls: the ledger keeps them (Float minor units).
      const amountMajor = price.price * units;
      out.push(await recordCostEvent({ provider, category: "ai", feature: u.feature, userId: u.userId ?? null, model, units, unit: TOKEN_UNIT[side], unitPriceId: price.id, amountMinor: amountMajor * 100, currency: price.currency, source: "reported", at, meta: { side, unitPrice: price.price } }));
    }
    return out;
  } catch (e) {
    console.error("[costs] tokens", u.provider, u.model, e);
    return [];
  }
}
