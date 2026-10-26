/** Client-safe money helpers. Amounts are always integer minor units. */
export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD", "AED"] as const;
export type Currency = (typeof CURRENCIES)[number];

const LOCALE: Record<string, string> = { INR: "en-IN", USD: "en-US", EUR: "en-IE", GBP: "en-GB" }; // others use en-US, which prints CA$ / A$ / SGD / AED unambiguously;

export function formatMoney(minor: number, currency: string, opts: { compact?: boolean } = {}) {
  const v = minor / 100;
  try {
    return new Intl.NumberFormat(LOCALE[currency] ?? "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: opts.compact || Number.isInteger(v) ? 0 : 2,
      notation: opts.compact && Math.abs(v) >= 100000 ? "compact" : "standard",
    }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

export const intervalLabel = (i: string) => (i === "year" ? "/yr" : "/mo");

export interface PublicPlan {
  id: string;
  slug: string;
  name: string;
  priceMinor: number;
  currency: string;
  interval: string;
  note: string;
  features: string[];
  state: "available" | "soon" | "hidden";
  highlight: boolean;
  sortOrder: number;
  /** Admin-set prices in other currencies (minor units). Missing ones are converted. */
  prices: Partial<Record<Currency, number>>;
  /** Yearly price in `currency` for a monthly plan. 0 = monthly x (12 - free months). */
  yearlyMinor: number;
  /** Posts per calendar month; 0 = unlimited. */
  postLimit: number;
  aiCaptions: boolean;
  seats: number;
  /** Window postLimit counts over. */
  postPeriod: "week" | "month";
  /** Max upload per file in MB; 0 = server maximum. */
  maxUploadMb: number;
  /** Inbox replies per week; 0 = unlimited. */
  replyLimit: number;
  /** Videos per month with AI captions; 0 = unlimited. */
  captionVideos: number;
  burnCaptions: boolean;
}

export function priceLabel(p: Pick<PublicPlan, "priceMinor" | "currency" | "interval" | "state">) {
  if (p.state === "soon") return "Coming soon";
  if (p.priceMinor === 0) return "Free";
  return `${formatMoney(p.priceMinor, p.currency)}${intervalLabel(p.interval)}`;
}
