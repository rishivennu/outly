import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { activeGateway } from "@/lib/billing/service";
import { removeCard, savedCardsFor, setDefaultCard } from "@/lib/billing/saved-cards";

export const dynamic = "force-dynamic";

/**
 * 1118: saved cards on Billing. Razorpay holds the cards as tokens; this only lists the masked view,
 * marks one as the default and asks Razorpay to delete one. Owner only (team members never see billing).
 */
export const GET = route(async (_req, { user }) => {
  if (user.actor) throw new HttpError(404, "Not found", "not_found");
  return json(await savedCardsFor(user.id, await activeGateway()));
}, { limit: [30, 60_000] });

const Id = z.string().min(3).max(64).regex(/^[A-Za-z0-9_]+$/);

export const PATCH = route(async (req, { user }) => {
  if (user.actor) throw new HttpError(404, "Not found", "not_found");
  const { default: id } = z.object({ default: Id }).parse(await req.json());
  const gw = await activeGateway();
  const r = await setDefaultCard(user.id, gw, id);
  if (!r.ok) throw new HttpError(r.reason === "expired" ? 409 : 404, r.reason === "expired" ? "That card has expired, so it can't be the default." : "That card isn't saved any more.", `card_${r.reason}`);
  return json(await savedCardsFor(user.id, gw));
}, { limit: [20, 60_000] });

export const DELETE = route(async (req, { user }) => {
  if (user.actor) throw new HttpError(404, "Not found", "not_found");
  const { id } = z.object({ id: Id }).parse(await req.json());
  const gw = await activeGateway();
  let r;
  try {
    r = await removeCard(user.id, gw, id);
  } catch {
    throw new HttpError(502, "Razorpay didn't confirm the removal. Refresh to check, then try again in a minute.", "GATEWAY");
  }
  if (!r.ok) throw new HttpError(404, "That card isn't saved any more.", "card_missing");
  return json(await savedCardsFor(user.id, gw));
}, { limit: [20, 60_000] });
