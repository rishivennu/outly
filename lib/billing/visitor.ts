import "server-only";
import { cookies, headers } from "next/headers";
import { CURRENCY_COOKIE, detectCurrency } from "./currency";
import type { Currency } from "./money";

/** The current request's currency: their saved choice, else IP country (Vercel/Cloudflare), else browser language. */
export function visitorCurrency(fallback: Currency = "INR") {
  const h = headers();
  return detectCurrency((n) => h.get(n), cookies().get(CURRENCY_COOKIE)?.value, fallback);
}

/** Same thing from a raw Request, for route handlers. */
export function requestCurrency(req: Request, fallback: Currency = "INR") {
  const jar = req.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${CURRENCY_COOKIE}=([A-Z]{3})`).exec(jar);
  return detectCurrency((n) => req.headers.get(n), m?.[1], fallback);
}
