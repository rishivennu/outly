import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { limitShared } from "@/lib/rate-limit";
import { checkClaimToken, claimLinkOwnerIsMember, clearFoundingCache, markEmailVerified } from "@/lib/founding";

export const dynamic = "force-dynamic";

/**
 * The link in the "claim your founding seat" email. The signed token is the credential (it works in any
 * browser, signed in or not), it proves the inbox, and then the seat is claimed if one is still open and
 * the account has paid for a plan (1067).
 */
export async function GET(req: NextRequest) {
  // 1067: the seat's note lives on Billing now (Home only carries the one-time invitation).
  const go = (state: string) => NextResponse.redirect(new URL(`/billing?founding=${state}`, env.APP_URL), 303);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (!(await limitShared(`founding:verify:${ip}`, 20, 10 * 60_000)).ok) return go("busy");
  const t = req.nextUrl.searchParams.get("t") ?? "";
  const u = await checkClaimToken(t);
  // Links work once. Opened again (or a mail scanner got there first) by someone already seated: that's fine.
  if (!u) return go((await claimLinkOwnerIsMember(t)) ? "claimed" : "expired");
  const r = await markEmailVerified(u.id);
  clearFoundingCache();
  return go(r.result === "claimed" || r.result === "already" ? "claimed" : r.result);
}
