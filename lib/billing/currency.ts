/**
 * Visitor currency. Client-safe and pure, so the marketing page, billing and checkout all price the same way.
 *
 * Order of trust: an explicit choice (cookie) > the visitor's IP country (Vercel / Cloudflare headers)
 * > the region in their browser language > the plan's own currency.
 * A per-currency price set in the admin always wins over conversion; otherwise we convert from the plan's
 * currency at a fixed reference rate and round to a clean price point (5.99, 17.99, 4,99 €...).
 */
import { CURRENCIES, type Currency } from "./money";

export const CURRENCY_COOKIE = "ol_ccy";

/** Units of each currency per 1 USD. Reference rates for list prices, not a live FX feed. */
export const FX_PER_USD: Record<Currency, number> = {
  USD: 1,
  INR: 83.5,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.37,
  AUD: 1.52,
  SGD: 1.35,
  AED: 3.67,
};

const EURO = ["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"];

export const COUNTRY_CURRENCY: Record<string, Currency> = {
  US: "USD", PR: "USD", EC: "USD", SV: "USD", PA: "USD",
  IN: "INR",
  GB: "GBP", IM: "GBP", JE: "GBP", GG: "GBP",
  CA: "CAD",
  AU: "AUD",
  SG: "SGD",
  AE: "AED",
  ...Object.fromEntries(EURO.map((c) => [c, "EUR" as Currency])),
};

export const CURRENCY_NAME: Record<Currency, string> = {
  INR: "Indian rupee", USD: "US dollar", EUR: "Euro", GBP: "British pound",
  CAD: "Canadian dollar", AUD: "Australian dollar", SGD: "Singapore dollar", AED: "UAE dirham",
};

export const isCurrency = (v: unknown): v is Currency => typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);

export const currencyForCountry = (country: string | null | undefined): Currency | null =>
  (country && COUNTRY_CURRENCY[country.trim().toUpperCase()]) || null;

/** Region from an Accept-Language header: "en-GB,en;q=0.9" -> "GB". First tag that carries a region wins. */
export function regionFromLanguage(al: string | null | undefined): string | null {
  if (!al) return null;
  for (const part of al.split(",")) {
    const tag = part.split(";")[0].trim();
    const m = /^[a-z]{2,3}[-_]([a-z]{2})$/i.exec(tag);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

export type CurrencySource = "choice" | "ip" | "language" | "default";

/** `get` is any header lookup, e.g. `(n) => headers().get(n)`. */
export function detectCurrency(get: (name: string) => string | null | undefined, cookie: string | null | undefined, fallback: Currency = "INR"): { currency: Currency; source: CurrencySource; country: string | null } {
  if (isCurrency(cookie)) return { currency: cookie, source: "choice", country: null };
  const ip = (get("x-vercel-ip-country") || get("cf-ipcountry") || get("x-country-code") || "").toUpperCase() || null;
  const fromIp = currencyForCountry(ip);
  if (fromIp) return { currency: fromIp, source: "ip", country: ip };
  // A known IP country without its own currency here (e.g. JP, BR) prices in dollars, the widest-accepted option.
  if (ip && ip !== "XX" && ip !== "T1") return { currency: "USD", source: "ip", country: ip };
  const region = regionFromLanguage(get("accept-language"));
  const fromLang = currencyForCountry(region);
  if (fromLang) return { currency: fromLang, source: "language", country: region };
  return { currency: fallback, source: "default", country: null };
}

/** Clean price point in minor units: >= 10 units -> whole-minus-a-cent (17.99), small amounts -> .99, INR -> nearest 9 (499, 1,499). */
export function nicePrice(minor: number, currency: Currency) {
  if (minor <= 0) return 0;
  const v = minor / 100;
  if (currency === "INR") return Math.max(9, Math.round((v + 1) / 10) * 10 - 1) * 100;
  return Math.max(99, Math.round(v) * 100 - 1);
}

export function parsePrices(raw: unknown): Partial<Record<Currency, number>> {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  }
  const out: Partial<Record<Currency, number>> = {};
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) if (isCurrency(k) && Number.isInteger(v) && (v as number) >= 0) out[k] = v as number;
  return out;
}

export interface Priced {
  priceMinor: number;
  currency: Currency;
  /** true when the number came from conversion rather than a price the admin set. */
  converted: boolean;
}

/** The price of a plan in `target`. Free stays free; an admin-set price wins; otherwise convert and round. */
export function localPrice(plan: { priceMinor: number; currency: string; prices?: Partial<Record<Currency, number>> }, target: Currency): Priced {
  const base = isCurrency(plan.currency) ? plan.currency : "INR";
  if (plan.priceMinor <= 0) return { priceMinor: 0, currency: target, converted: false };
  if (target === base) return { priceMinor: plan.priceMinor, currency: base, converted: false };
  const set = plan.prices?.[target];
  if (set && set > 0) return { priceMinor: set, currency: target, converted: false };
  const usd = plan.priceMinor / FX_PER_USD[base];
  return { priceMinor: nicePrice(usd * FX_PER_USD[target], target), currency: target, converted: true };
}

/** PayPal can't take AED, and INR only works for accounts registered in India, so those are charged in USD. */
export const PAYPAL_CURRENCIES: readonly Currency[] = ["USD", "EUR", "GBP", "CAD", "AUD", "SGD"];

/** Which currency a gateway can actually charge. Razorpay accounts are INR unless international is enabled, so it bills in the plan's own currency. */
export function chargeCurrency(gateway: string, wanted: Currency, planCurrency: string): Currency {
  if (gateway === "youpi") return "INR"; // UPI is rupees only
  if (gateway === "razorpay") return isCurrency(planCurrency) ? planCurrency : "INR";
  if (gateway === "paypal") return PAYPAL_CURRENCIES.includes(wanted) ? wanted : "USD";
  return wanted;
}
