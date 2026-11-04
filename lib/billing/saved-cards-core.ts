/**
 * 1118: saved cards, as Razorpay hands them back. Pure, so it is unit tested.
 * Razorpay tokenises the card (RBI card-on-file rules); Outlly never sees or stores a card number,
 * only the masked view below: network, last 4, expiry, type, issuer.
 */
export type CardNetwork = "visa" | "mastercard" | "amex" | "rupay" | "maestro" | "diners" | "discover" | "jcb" | "card";

export type SavedCard = {
  id: string;
  network: CardNetwork;
  networkLabel: string;
  last4: string;
  /** "MM/YY", or null when Razorpay did not share it. */
  expiry: string | null;
  expired: boolean;
  type: "credit" | "debit" | "prepaid" | null;
  issuer: string | null;
  isDefault: boolean;
  lastUsedAt: string | null;
  createdAt: string | null;
};

const NETWORKS: Record<string, [CardNetwork, string]> = {
  visa: ["visa", "Visa"],
  mastercard: ["mastercard", "Mastercard"],
  "american express": ["amex", "Amex"],
  amex: ["amex", "Amex"],
  rupay: ["rupay", "RuPay"],
  maestro: ["maestro", "Maestro"],
  "diners club": ["diners", "Diners"],
  dinersclub: ["diners", "Diners"],
  diners: ["diners", "Diners"],
  discover: ["discover", "Discover"],
  jcb: ["jcb", "JCB"],
};

export function networkOf(raw: unknown): [CardNetwork, string] {
  return NETWORKS[String(raw ?? "").trim().toLowerCase()] ?? ["card", "Card"];
}

const iso = (sec: unknown) => (typeof sec === "number" && sec > 0 ? new Date(sec * 1000).toISOString() : null);

/** One Razorpay token -> the masked card we show. Anything that isn't a usable card token is dropped (null). */
export function cardOfToken(t: any, now = new Date()): Omit<SavedCard, "isDefault"> | null {
  if (!t || typeof t.id !== "string" || t.method !== "card" || !t.card) return null;
  const c = t.card;
  const last4 = String(c.last4 ?? "").replace(/\D/g, "").slice(-4);
  if (last4.length !== 4) return null;
  const [network, networkLabel] = networkOf(c.network);
  const mm = Number(c.expiry_month);
  const yy = Number(c.expiry_year);
  const hasExp = mm >= 1 && mm <= 12 && yy > 0;
  const fullYear = yy < 100 ? 2000 + yy : yy;
  // A card is good through the last day of its expiry month.
  const expiredByDate = hasExp && new Date(Date.UTC(fullYear, mm, 1)) <= now;
  const expiredByToken = typeof t.expired_at === "number" && t.expired_at > 0 && t.expired_at * 1000 <= now.getTime();
  const type = c.type === "credit" || c.type === "debit" || c.type === "prepaid" ? c.type : null;
  return {
    id: t.id,
    network,
    networkLabel,
    last4,
    expiry: hasExp ? `${String(mm).padStart(2, "0")}/${String(fullYear % 100).padStart(2, "0")}` : null,
    expired: expiredByDate || expiredByToken,
    type,
    issuer: typeof c.issuer === "string" && c.issuer ? c.issuer : null,
    lastUsedAt: iso(t.used_at),
    createdAt: iso(t.created_at),
  };
}

/**
 * Tokens -> cards, newest first. The default is the one the user picked if it still exists,
 * otherwise the most recently used card that hasn't expired.
 */
export function savedCardsOf(tokens: unknown[], defaultId: string | null | undefined, now = new Date()): SavedCard[] {
  const seen = new Set<string>();
  const cards = (Array.isArray(tokens) ? tokens : [])
    .map((t) => cardOfToken(t, now))
    .filter((c): c is Omit<SavedCard, "isDefault"> => !!c && !seen.has(c.id) && (seen.add(c.id), true))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const usable = cards.filter((c) => !c.expired);
  const picked =
    (defaultId && usable.find((c) => c.id === defaultId)?.id) ||
    [...usable].sort((a, b) => (b.lastUsedAt ?? b.createdAt ?? "").localeCompare(a.lastUsedAt ?? a.createdAt ?? ""))[0]?.id ||
    null;
  return cards.map((c) => ({ ...c, isDefault: c.id === picked }));
}
