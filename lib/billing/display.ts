/**
 * How the pricing cards look and whether yearly billing is offered. Client-safe: the landing page,
 * billing page and the admin preview all read the same shape. Stored in Settings under "pricing".
 */
export const CARD_STYLES = ["live", "classic", "glass", "bold"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

export const CARD_STYLE_META: Record<CardStyle, { label: string; hint: string }> = {
  live: { label: "Live Activity", hint: "Dot-letter names, glowing price box. The current look." },
  classic: { label: "Classic", hint: "The previous cards: clean outline, lime border on the popular plan." },
  glass: { label: "Glass", hint: "Frosted panels with a soft lime glow behind the popular plan." },
  bold: { label: "Bold", hint: "The popular plan is a solid lime card with a big price." },
};

export interface PricingDisplay {
  cardStyle: CardStyle;
  /** Offer a Monthly / Yearly switch on monthly plans. */
  yearly: boolean;
  /** Months free when paying yearly; sets the automatic yearly price (monthly x (12 - this)). */
  freeMonths: number;
}

export const PRICING_DISPLAY_DEFAULT: PricingDisplay = { cardStyle: "live", yearly: true, freeMonths: 2 };

export function normalizeDisplay(v: unknown): PricingDisplay {
  const o = (v && typeof v === "object" ? v : {}) as Partial<PricingDisplay>;
  const fm = Number(o.freeMonths);
  return {
    cardStyle: (CARD_STYLES as readonly string[]).includes(o.cardStyle as string) ? (o.cardStyle as CardStyle) : PRICING_DISPLAY_DEFAULT.cardStyle,
    yearly: typeof o.yearly === "boolean" ? o.yearly : PRICING_DISPLAY_DEFAULT.yearly,
    freeMonths: Number.isInteger(fm) && fm >= 0 && fm <= 6 ? fm : PRICING_DISPLAY_DEFAULT.freeMonths,
  };
}
