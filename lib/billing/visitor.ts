import "server-only";
import { headers } from "next/headers";
import { detectCurrency } from "./currency";
import type { Currency } from "./money";

/**
 * The current request's currency, from location only: IP country (Vercel/Cloudflare), else browser language.
 * There is no way to pick another one, so every page, the billing cards and checkout always agree.
 */
export function visitorCurrency(fallback: Currency = "INR") {
  const h = headers();
  return detectCurrency((n) => h.get(n), null, fallback);
}

/** Same thing from a raw Request, for route handlers. */
export function requestCurrency(req: Request, fallback: Currency = "INR") {
  return detectCurrency((n) => req.headers.get(n), null, fallback);
}
