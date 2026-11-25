import "server-only";
import { recordEconomicsUse } from "./ledger";

/**
 * R1331: X's paid API tiers bill every post a read endpoint returns (the Basic tier's monthly cap is on posts
 * read, not requests). Count the posts that came back at the 1147 `x_read` rate into the cost ledger, attributed
 * to the user: an estimate, never a block. Reads stay out of the user's own monthly budget (lib/subscriptions/costs
 * recordCost) on purpose: the Inbox and the live dashboard read on the user's behalf and they cannot ration it;
 * posting is what the budget meters. Nothing for other platforms, practice accounts or empty answers.
 */
export async function meterXReads(userId: string, platform: string, posts: number, practice = false, now?: Date) {
  if (platform !== "x" || practice || !(posts > 0)) return null;
  return recordEconomicsUse({ userId, category: "x_read", units: Math.floor(posts), now });
}
