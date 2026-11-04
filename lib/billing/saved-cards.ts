import "server-only";
import { db } from "../db";
import type { PaymentConfig } from "../settings";
import { razorpay } from "./providers";
import { savedCardsOf, type SavedCard } from "./saved-cards-core";

export type SavedCardsView = {
  /** Saved cards only exist through Razorpay; any other gateway says so instead of pretending. */
  supported: boolean;
  gateway: string;
  cards: SavedCard[];
  /** Razorpay could not be reached: show what we know, say the list couldn't load. */
  lookupFailed: boolean;
};

/** The user's Razorpay customer, created once and remembered. Best effort: checkout still works without it. */
export async function ensureRzpCustomer(cfg: PaymentConfig, user: { id: string; name: string; email: string; rzpCustomerId?: string | null }): Promise<string | undefined> {
  if (user.rzpCustomerId) return user.rzpCustomerId;
  try {
    const id = await razorpay.ensureCustomer(cfg, { name: user.name, email: user.email });
    await db.user.update({ where: { id: user.id }, data: { rzpCustomerId: id } });
    return id;
  } catch (e) {
    console.warn("[billing] could not create a Razorpay customer:", (e as Error).message);
    return undefined;
  }
}

export async function savedCardsFor(userId: string, gw: { cfg: PaymentConfig; provider: string }): Promise<SavedCardsView> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { rzpCustomerId: true, defaultCardToken: true } });
  const supported = gw.provider === "razorpay";
  if (!supported || !user?.rzpCustomerId) return { supported, gateway: gw.provider, cards: [], lookupFailed: false };
  try {
    const tokens = await razorpay.listTokens(gw.cfg, user.rzpCustomerId);
    return { supported, gateway: gw.provider, cards: savedCardsOf(tokens, user.defaultCardToken), lookupFailed: false };
  } catch (e) {
    console.warn("[billing] saved cards lookup failed:", (e as Error).message);
    return { supported, gateway: gw.provider, cards: [], lookupFailed: true };
  }
}

/** Only a card Razorpay actually lists for this customer can become the default. */
export async function setDefaultCard(userId: string, gw: { cfg: PaymentConfig; provider: string }, tokenId: string) {
  const view = await savedCardsFor(userId, gw);
  const card = view.cards.find((c) => c.id === tokenId);
  if (!card) return { ok: false as const, reason: "missing" as const };
  if (card.expired) return { ok: false as const, reason: "expired" as const };
  await db.user.update({ where: { id: userId }, data: { defaultCardToken: tokenId } });
  return { ok: true as const };
}

export async function removeCard(userId: string, gw: { cfg: PaymentConfig; provider: string }, tokenId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { rzpCustomerId: true, defaultCardToken: true } });
  if (!user?.rzpCustomerId || gw.provider !== "razorpay") return { ok: false as const, reason: "missing" as const };
  const view = await savedCardsFor(userId, gw);
  if (!view.cards.some((c) => c.id === tokenId)) return { ok: false as const, reason: "missing" as const };
  await razorpay.deleteToken(gw.cfg, user.rzpCustomerId, tokenId);
  // The card is already gone at Razorpay: a failed clean-up here must not report the removal as failed.
  if (user.defaultCardToken === tokenId) await db.user.update({ where: { id: userId }, data: { defaultCardToken: null } }).catch(() => null);
  return { ok: true as const };
}
